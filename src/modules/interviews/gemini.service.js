'use strict';

const { GoogleGenAI, Modality } = require('@google/genai');
const env = require('../../config/env.config');
const logger = require('../../utils/logger.util');

const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

function buildSystemInstruction(scenarioContext) {
  const ctxJson = JSON.stringify(scenarioContext || {}, null, 2);

  return [
    'You are a STRICT United States Consular Officer conducting a non-immigrant visa interview at a US Embassy / Consulate.',
    '',
    'RULES OF ENGAGEMENT:',
    '- Stay fully in character. Never reveal you are an AI.',
    '- Be terse, skeptical, and authoritative. Ask short, pointed questions.',
    '- Probe inconsistencies. Interrupt if the applicant rambles.',
    '- Demand specifics: dates, amounts, names of institutions, ties to home country, intent to return.',
    '- Make a final decision only after sufficient questioning: APPROVED, ADMINISTRATIVE PROCESSING (221g), or REFUSED (214b).',
    '- Do NOT coach the applicant. Do NOT explain consular procedure.',
    '',
    'SCENARIO CONTEXT (provided by the platform — treat as ground truth about the applicant\'s stated trip):',
    '```json',
    ctxJson,
    '```',
    '',
    'Begin the interview by greeting the applicant and asking for their passport and the purpose of their visit.',
  ].join('\n');
}

/**
 * Opens a bi-directional live session with Gemini.
 *
 * @param {object} opts
 * @param {object} opts.scenarioContext  - Arbitrary JSON context injected into system instructions.
 * @param {(msg: object) => void} opts.onMessage  - Called for every server message from Gemini.
 * @param {(err: Error) => void}  opts.onError
 * @param {() => void}            opts.onClose
 * @returns {Promise<{session: any, close: () => Promise<void>}>}
 */
async function openLiveSession({ scenarioContext, onMessage, onError, onClose }) {
  const systemInstruction = buildSystemInstruction(scenarioContext);

  const session = await client.live.connect({
    model: env.GEMINI_MODEL,
    config: {
      responseModalities: [Modality.AUDIO, Modality.TEXT],
      systemInstruction: { parts: [{ text: systemInstruction }] },
    },
    callbacks: {
      onopen: () => logger.info('Gemini live session opened'),
      onmessage: (msg) => {
        try {
          onMessage && onMessage(msg);
        } catch (e) {
          logger.error('onMessage handler threw:', e);
        }
      },
      onerror: (err) => {
        logger.error('Gemini live session error:', err && err.message);
        onError && onError(err);
      },
      onclose: () => {
        logger.info('Gemini live session closed');
        onClose && onClose();
      },
    },
  });

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
