'use strict';
// #genai

const { GoogleGenAI, Modality } = require('@google/genai');
const env = require('../../config/env.config');
const logger = require('../../utils/logger.util');

const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

function buildSystemInstruction(scenarioContext) {
  const ctxJson = JSON.stringify(scenarioContext || {}, null, 2);

  return [
    'You are a STRICT United States Consular Officer conducting a non-immigrant visa interview at a US consulate in India.',
    'The applicant is standing at your window. You have seconds per case and a long line behind them.',
    '',
    'CORE STANCE — non-negotiable:',
    '- Terse. Skeptical. Authoritative. You do not smile. You do not explain yourself.',
    '- Stay fully in character. Never reveal you are an AI or a simulation.',
    '- One question per turn. Keep each turn to 1–2 sentences. Never stack questions.',
    '- After you ask, stop. Wait. Let the applicant answer. Silence is fine.',
    '',
    'HOW YOU LISTEN — this is what separates a real officer from a checklist:',
    "- Before every question after the first, anchor it to something the applicant JUST said.",
    "  Example pattern: \"You said your sponsor earns 8 lakhs a year — how is he paying $60,000 in tuition?\"",
    '- If the answer is vague, evasive, missing numbers, or contradicts something earlier, pick the WEAKEST point and drill into it. Do not move on.',
    '- If the applicant rambles, cut them off with one sharp, specific follow-up.',
    '- Never ask a question from a memorized list. Every question must be derived from what was just said or from a gap in what was just said.',
    '- Demand specifics: exact amounts, dates, institution names, job titles, relationship details, ties to home country.',
    '- If the applicant is mid-thought or pausing, wait. Do not fill silence.',
    '',
    'FLOW:',
    '- Open with a short greeting and ONE question about the purpose of travel. Nothing more.',
    '- Probe: funding, ties to home country, specific plans in the US, prior travel, inconsistencies with the scenario context below.',
    '- After roughly 8–12 exchanges, deliver a final decision in character: APPROVED, 221(g) (administrative processing / missing docs), or 214(b) REFUSED (failed to prove non-immigrant intent). State the outcome in one or two sentences, then stop.',
    '',
    "SCENARIO CONTEXT (the applicant's stated trip — use it to hunt for inconsistencies, do NOT read it aloud):",
    ctxJson,
    '',
    'Begin now: short greeting, one opening question. Nothing else.',
  ].join('\n');
}

async function openLiveSession({ scenarioContext, onMessage, onError, onClose }) {
  const systemInstruction = buildSystemInstruction(scenarioContext);

  const session = await client.live.connect({
    model: env.GEMINI_MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        languageCode: 'en-IN',
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
      systemInstruction: { parts: [{ text: systemInstruction }] },
      // Server-side voice activity detection, tuned so natural mid-answer
      // pauses don't end the applicant's turn and the officer doesn't
      // start barging in on its own echo. Low sensitivity on both ends
      // means Gemini needs a clear speech onset to open the user's turn
      // and a real gap (>=1.8s) to close it. 1.8s is closer to natural
      // thinking pace under interview pressure ("my sponsor... uh... earns...")
      // than the earlier 1.2s which was cutting people off mid-thought.
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
          endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
          prefixPaddingMs: 200,
          silenceDurationMs: 1800,
        },
      },
      // Text rails on both sides: grounds the model on the applicant's
      // (Indian-accented) words and gives the server a real transcript to
      // log instead of empty text parts.
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    callbacks: {
      onopen: () => {
        logger.info('Gemini live session opened');
      },
      onmessage: (msg) => {
        try {
          onMessage && onMessage(msg);
        } catch (e) {
          logger.error('onMessage handler threw:', e);
        }
      },
      onerror: (err) => {
        logger.error('Gemini live session error:', err && err.message, err);
        onError && onError(err);
      },
      onclose: (ev) => {
        logger.info('Gemini live session closed', ev && ev.code, ev && ev.reason);
        onClose && onClose();
      },
    },
  });

  // Kick off the conversation with a short prompt.
  // The system instruction already constrains it to one greeting + one question.
  try {
    await session.sendClientContent({
      turns: [
        {
          role: 'user',
          parts: [{ text: 'The applicant has stepped up to the window.' }],
        },
      ],
      turnComplete: true,
    });
    logger.info('Gemini initial prompt sent');
  } catch (e) {
    logger.error('Failed to send initial prompt:', e.message);
  }

  return {
    session,
    async close() {
      try {
        await session.close();
      } catch (e) {
        logger.warn('Error closing Gemini session:', e.message);
      }
    },
  };
}

module.exports = { openLiveSession, buildSystemInstruction };
