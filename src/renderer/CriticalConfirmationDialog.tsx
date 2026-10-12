import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import type {
  CriticalConfirmationDecision,
  CriticalConfirmationPrompt,
} from "../shared/critical-confirmation";
import { DialogShell } from "./ui/patterns";

export function CriticalConfirmationDialog({
  request,
  onDecide,
  confirmVariant = "danger",
  dialogId = "critical-confirmation-dialog",
}: {
  request: CriticalConfirmationPrompt | null;
  onDecide: (decision: CriticalConfirmationDecision) => void;
  confirmVariant?: "danger" | "primary";
  dialogId?: string;
}) {
  if (!request) return null;
  const confirmIsDefault = request.initialFocus === "confirm";
  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog"
        description={request.message}
        dialogId={dialogId}
        headerActions={(
          <button
            className="dialog-close"
            onClick={() => onDecide("cancel")}
            type="button"
            {...iconActionAttrs(request.cancelLabel)}
          >
            <Icon name="close" size={16} />
          </button>
        )}
        onRequestClose={() => onDecide("cancel")}
        style={{ padding: 0 }}
        title={request.heading}
      >
        {request.detail ? <p className="dialog-body-copy">{request.detail}</p> : null}
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={() => onDecide("cancel")}
            type="button"
            {...(confirmIsDefault ? {} : { "data-dialog-initial-focus": "true" })}
          >
            {request.cancelLabel}
          </button>
          <button
            className={`ui-button ui-button--${confirmVariant}`}
            onClick={() => onDecide("confirm")}
            type="button"
            {...(confirmIsDefault
              ? {
                  "data-dialog-default-action": "true",
                  "data-dialog-initial-focus": "true",
                }
              : {})}
          >
            {request.confirmLabel}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
