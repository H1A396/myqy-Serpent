/**
 * Inspector pending-edit resolution (Serpent-cb40bb).
 *
 * Background-derived metadata refreshes — palette / EXIF-author extraction —
 * finish while the user may be typing into the Inspector. Re-applying the
 * freshly loaded row wholesale would reset every edit field and silently
 * discard text that has not been committed on blur yet. This helper compares
 * the local drafts against the metadata the user last saw and reports which
 * fields must be preserved. Pure so it can be unit tested without React.
 */

export type InspectorEditDraft = {
  description: string;
  rating: number;
  favorite: boolean;
  sourcePageUrl: string;
  author: string;
};

export type InspectorLoadedEditableFields = {
  description: string | null;
  rating: number;
  favorite: boolean;
  sourcePageUrl: string | null;
  author: string | null;
};

export type InspectorPendingEditFlags = {
  description: boolean;
  rating: boolean;
  favorite: boolean;
  sourcePageUrl: boolean;
  author: boolean;
};

const NO_PENDING_EDITS: InspectorPendingEditFlags = {
  description: false,
  rating: false,
  favorite: false,
  sourcePageUrl: false,
  author: false,
};

/**
 * A field is pending when the draft differs from the value stored in the
 * metadata row the user last loaded. When no previous row exists there is no
 * baseline to compare against, so nothing is treated as pending.
 */
export function resolveInspectorPendingEdits(
  previous: InspectorLoadedEditableFields | undefined,
  draft: InspectorEditDraft,
): InspectorPendingEditFlags {
  if (!previous) return NO_PENDING_EDITS;
  return {
    description: draft.description !== (previous.description ?? ""),
    rating: draft.rating !== previous.rating,
    favorite: draft.favorite !== previous.favorite,
    sourcePageUrl: draft.sourcePageUrl !== (previous.sourcePageUrl ?? ""),
    author: draft.author !== (previous.author ?? ""),
  };
}
