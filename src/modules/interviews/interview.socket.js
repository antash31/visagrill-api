'use strict';

const { verifyToken } = require('../../middlewares/auth.middleware');
const interviewService = require('./interview.service');
const geminiService = require('./gemini.service');
const logger = require('../../utils/logger.util');

/**
 * In-memory session store: interview_id -> {
 *   userId, transcriptLog: [], gemini: {session, close}, endedAt: null
 * }
 *
 * Transcript is only persisted on `end_interview` or `disconnect`,
 * not per-message.
 */
const activeSessions = new Map();

function attachSocketAuth(io) {
  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth && socket.handshake.auth.token) ||
        (socket.handshake.query && socket.handshake.query.token) ||
        null;

      if (!token) return next(new Error('Missing auth token'));

      const user = await verifyToken(token);
      socket.data.user = user;
      return next();
    } catch (err) {
      logger.warn('Socket auth failed:', err.message);
      return next(new Error('Unauthorized'));
    }
  });
}

function registerInterviewNamespace(io) {
  attachSocketAuth(io);

  io.on('connection', (socket) => {
    const user = socket.data.user;
    logger.info(`Socket connected: ${socket.id} user=${user.id}`);

    let ctx = null; // per-connection state

    socket.on('start_interview', async (payload, ack) => {
      try {
        const { interview_id } = payload || {};
        if (!interview_id) throw new Error('interview_id is required');

        const interview = await interviewService.assertOwnedInterview({
          interviewId: interview_id,
          userId: user.id,
        });

        ctx = {
          interviewId: interview.id,
          userId: user.id,
          transcriptLog: [],
          gemini: null,
          ended: false,
        };
        activeSessions.set(interview.id, ctx);

        const gemini = await geminiService.openLiveSession({
          scenarioContext: interview.scenario_context || {},
          onMessage: (msg) => {
            // Forward the Gemini server message to the client.
            socket.emit('ai_message', msg);

            // Best-effort transcript capture (model -> applicant).
            const text = extractText(msg);
            if (text) {
              ctx.transcriptLog.push({
                speaker: 'ai_officer',
                text,
                timestamp: new Date().toISOString(),
              });
            }
          },
          onError: (err) => socket.emit('ai_error', { message: err && err.message }),
          onClose: () => socket.emit('ai_closed'),
        });

        ctx.gemini = gemini;
        ack && ack({ ok: true, interview_id: interview.id });
      } catch (err) {
        logger.error('start_interview error:', err.message);
        ack && ack({ ok: false, error: err.message });
      }
    });

    // Applicant streams audio chunks (base64 PCM) to the server.
    socket.on('applicant_audio', async (payload) => {
      if (!ctx || !ctx.gemini) return;
      try {
        const { audio_base64, mime_type } = payload || {};
        if (!audio_base64) return;
        await ctx.gemini.session.sendRealtimeInput({
          media: { data: audio_base64, mimeType: mime_type || 'audio/pcm;rate=16000' },
        });
      } catch (err) {
        logger.warn('applicant_audio forward failed:', err.message);
      }
    });

    // Optional: client-side transcribed applicant text (for logging purposes).
    socket.on('applicant_text', (payload) => {
      if (!ctx) return;
      const text = (payload && payload.text) || '';
      if (!text) return;
      ctx.transcriptLog.push({
        speaker: 'applicant',
        text,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('end_interview', async (_payload, ack) => {
      await finalizeAndCleanup(ctx, 'end_interview');
      ack && ack({ ok: true });
    });

    socket.on('disconnect', async (reason) => {
      logger.info(`Socket disconnected: ${socket.id} (${reason})`);
      await finalizeAndCleanup(ctx, 'disconnect');
    });
  });
}

async function finalizeAndCleanup(ctx, trigger) {
  if (!ctx || ctx.ended) return;
  ctx.ended = true;

  try {
    if (ctx.gemini) await ctx.gemini.close();
  } catch (e) {
    logger.warn('Error closing gemini session on cleanup:', e.message);
  }

  try {
    await interviewService.finalizeInterview({
      interviewId: ctx.interviewId,
      userId: ctx.userId,
      transcriptLog: ctx.transcriptLog,
    });
    logger.info(
      `Interview ${ctx.interviewId} finalized (${trigger}) with ${ctx.transcriptLog.length} transcript entries`,
    );
  } catch (e) {
    logger.error('Failed to finalize interview:', e.message);
  } finally {
    activeSessions.delete(ctx.interviewId);
  }
}

function extractText(msg) {
  try {
    if (!msg) return null;
    if (msg.text) return msg.text;
    const parts =
      (msg.serverContent && msg.serverContent.modelTurn && msg.serverContent.modelTurn.parts) || [];
    const texts = parts.map((p) => p.text).filter(Boolean);
    return texts.length ? texts.join(' ') : null;
  } catch {
    return null;
  }
}

module.exports = { registerInterviewNamespace };
