import type { IncidentUpdate } from '../status/model.js';

// Checking a posted incident update (D-038). The text is trimmed; HTML in it stays text (Eta escapes it).

export const MAX_UPDATE_CHARS = 2000;
export const STAGES: IncidentUpdate['stage'][] = ['investigating', 'identified', 'monitoring', 'resolved'];

export interface UpdateErrors {
  stage?: string;
  body?: string;
}

export type ParsedUpdate =
  | { ok: true; stage: IncidentUpdate['stage']; body: string }
  | { ok: false; errors: UpdateErrors };

export function parseUpdate(fields: Record<string, unknown>): ParsedUpdate {
  const stage = STAGES.find((s) => s === fields.stage);
  const body = typeof fields.body === 'string' ? fields.body.trim() : '';
  const errors: UpdateErrors = {};
  if (!stage) errors.stage = 'Choose a stage.';
  // Characters as people count them (code points), not UTF-16 units.
  if (body.length === 0) errors.body = 'Write the update before posting.';
  else if ([...body].length > MAX_UPDATE_CHARS) errors.body = `Shorten the update to ${MAX_UPDATE_CHARS} characters or fewer.`;
  return stage && !errors.body ? { ok: true, stage, body } : { ok: false, errors };
}
