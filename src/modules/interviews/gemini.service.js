'use strict';

const { GoogleGenAI, Modality } = require('@google/genai');
const env = require('../../config/env.config');
const logger = require('../../utils/logger.util');

const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

function buildSystemInstruction(scenarioContext) {
  const ctxJson = JSON.stringify(scenarioContext || {}, null, 2);

  return [
    'You are a STRICT United States Consular Officer conducting a non-immigrant visa interview.',
    '',
    'CONVERSATION RULES — THESE ARE ABSOLUTE:',
    '1. Ask ONE question at a time. ONE. Never ask two questions in the same turn.',
    '2. After asking a question, STOP TALKING IMMEDIATELY and WAIT for the applicant to respond.',
    '3. Keep each of your turns to 1-2 sentences maximum. Consular officers are terse.',
    '4. Listen carefully to what the applicant says before deciding your next question.',
    '5. Do NOT monologue. Do NOT list multiple questions. Do NOT give speeches.',
    '',
    'CHARACTER:',
    '- Stay fully in character. Never reveal you are an AI.',
    '- Be terse, skeptical, and authoritative.',
    '- Probe inconsistencies. If the applicant rambles, cut them off with a pointed follow-up.',
    '- Demand specifics: dates, amounts, names of institutions, ties to home country.',
    '- After 8-12 exchanges, make a final decision: APPROVED, 221(g), or 214(b) REFUSED.',
    '',
    "SCENARIO CONTEXT (the applicant's stated trip):",
    ctxJson,
    '',
    'Start with a short greeting and ask for the purpose of their visit. Nothing more.',
  ].join('\n');
}

async function openLiveSession({ scenarioContext, onMessage, onError, onClose }) {
  const systemInstruction = buildSystemInstruction(scenarioContext);

  const session = await client.live.connect({
    model: env.GEMINI_MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
      systemInstruction: { parts: [{ text: systemInstruction }] },
      // Server-side voice activity detection: Gemini will detect when the
      // user starts speaking and automatically interrupt its own output.
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
        },
      },
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
