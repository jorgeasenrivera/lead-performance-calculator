import {validateDraft} from '../scripts/scheduler-performance/persistence/validate.mjs';
import {validStoreId, validMonth} from '../scripts/scheduler-performance/persistence/identity.mjs';
import {copyDraftJson, draftError} from './scheduler-draft-transport.mjs';

// The editor bridge already exports the stored shape. Validate and detach it
// without stripping unknown fields or inventing availability and provenance.
const validateScope = scope => validStoreId(scope?.storeId) && validMonth(scope?.month);
function checked(value, scope) {
  if (!validateScope(scope)) throw draftError('unsupported-data');
  const result = validateDraft(copyDraftJson(value), scope);
  if (!result.ok) throw draftError('unsupported-data');
  return copyDraftJson(result.value);
}
export const schedulerDraftCodec = Object.freeze({
  validateScope,
  encode: checked,
  decode: checked,
  verify: value => checked(value, {storeId: value?.storeId, month: value?.month}),
});
