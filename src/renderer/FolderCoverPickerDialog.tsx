import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export interface FolderCoverPickerDialogProps {
  open: boolean;
  assetId: string;
  assetOptions: Array<{ assetId: string; displayName: string }>;
  onAssetChange: (assetId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Pick a library image already on the current page, matching the collection cover select. */
export function FolderCoverPickerDialog({
  open,
  assetId,
  assetOptions,
  onAssetChange,
  onConfirm,
  onCancel,
}: FolderCoverPickerDialogProps) {
  const t = useT();
  if (!open) return null;
  const canSave = assetId.length > 0 && assetOptions.some((asset) => asset.assetId === assetId);

  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog"
        dialogId="folder-cover-picker"
        headerActions={
          <button
            className="dialog-close"
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        title={t("dialog.folderCover.title")}
        style={{ padding: 0 }}
      >
        <label className="field-label" htmlFor="folder-cover-asset">
          {t("dialog.folderCover.asset")}
        </label>
        <select
          className="text-field"
          id="folder-cover-asset"
          onChange={(event) => onAssetChange(event.target.value)}
          value={assetId}
        >
          <option value="">{t("dialog.folderCover.none")}</option>
          {assetOptions.map((asset) => (
            <option key={asset.assetId} value={asset.assetId}>
              {asset.displayName}
            </option>
          ))}
        </select>
        <p className="field-help">
          {assetOptions.length === 0
            ? t("dialog.folderCover.empty")
            : t("dialog.folderCover.help")}
        </p>
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            {t("common.cancel")}
          </button>
          <button
            className="primary-button"
            disabled={!canSave}
            onClick={onConfirm}
            type="button"
          >
            {t("dialog.folderCover.save")}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
