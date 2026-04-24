'use strict';
// #genai

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
          promoted: false, // true once status moves to in_progress (point of no return)
        };
        activeSessions.set(interview.id, ctx);

        const gemini = await geminiService.openLiveSession({
          scenarioContext: interview.scenario_context || {},
          onMessage: async (msg) => {
            // Forward the Gemini server message to the client.
            socket.emit('ai_message', msg);

            // --- Point of No Return ---
            // On the first AI message, promote to in_progress so the credit is burned.
            if (!ctx.promoted) {
              ctx.promoted = true;
              try {
                await interviewService.promoteToInProgress({
                  interviewId: ctx.interviewId,
                  userId: ctx.userId,
                });
                logger.info(`Interview ${ctx.interviewId} promoted to in_progress (credit burned)`);
              } catch (e) {
                logger.error('Failed to promote interview to in_progress:', e.message);
              }
            }

            // Best-effort transcript capture. Gemini streams these as
            // partial deltas; we log each chunk and collapse later during
            // feedback generation.
            const officerText = extractText(msg);
            if (officerText) {
              ctx.transcriptLog.push({
                speaker: 'ai_officer',
                text: officerText,
                timestamp: new Date().toISOString(),
              });
            }

            const applicantText = extractInputTranscription(msg);
            if (applicantText) {
              ctx.transcriptLog.push({
                speaker: 'applicant',
                text: applicantText,
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
    if (!ctx.promoted) {
      // Interview never reached in_progress — refund the held credit.
      const result = await interviewService.refundCreditIfAborted({
        interviewId: ctx.interviewId,
        userId: ctx.userId,
      });
      logger.info(
        `Interview ${ctx.interviewId} aborted before start (${trigger}), refund=${result.refunded}`,
      );
    } else {
      // Interview was in_progress — finalize normally (credit is burned).
      await interviewService.finalizeInterview({
        interviewId: ctx.interviewId,
        userId: ctx.userId,
        transcriptLog: ctx.transcriptLog,
      });
      logger.info(
        `Interview ${ctx.interviewId} finalized (${trigger}) with ${ctx.transcriptLog.length} transcript entries`,
      );
    }
  } catch (e) {
    logger.error('Failed to finalize/refund interview:', e.message);
  } finally {
    activeSessions.delete(ctx.interviewId);
  }
}

// Pull the officer's spoken text out of a Gemini live message.
// With audio-only response modality, `modelTurn.parts[].text` is usually
// empty; the real source is `serverContent.outputTranscription.text`,
// which Gemini emits when outputAudioTranscription is enabled on the session.
function extractText(msg) {
  try {
    if (!msg) return null;
    const outputTx =
      msg.serverContent &&
      msg.serverContent.outputTranscription &&
      msg.serverContent.outputTranscription.text;
    if (outputTx) return outputTx;

    if (msg.text) return msg.text;
    const parts =
      (msg.serverContent && msg.serverContent.modelTurn && msg.serverContent.modelTurn.parts) || [];
    const texts = parts.map((p) => p.text).filter(Boolean);
    return texts.length ? texts.join(' ') : null;
  } catch {
    return null;
  }
}

// Pull the applicant's speech-to-text (server-side transcription of the
// mic audio we streamed in). Requires inputAudioTranscription on the session.
function extractInputTranscription(msg) {
  try {
    if (!msg) return null;
    const inputTx =
      msg.serverContent &&
      msg.serverContent.inputTranscription &&
      msg.serverContent.inputTranscription.text;
    return inputTx || null;
  } catch {
    return null;
  }
}

module.exports = { registerInterviewNamespace };
