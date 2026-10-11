import type { ReactNode } from "react";

import { useT } from "./i18n";

export function FindSimilarBanner({
  displayName,
  coverUrl,
  onBack,
}: {
  displayName: string;
  coverUrl: string | null;
  onBack: () => void;
}): ReactNode {
  const t = useT();
  return (
    <div className="find-similar-banner" role="status">
      {coverUrl ? (
        <img alt="" className="find-similar-banner-thumb" src={coverUrl} />
      ) : (
        <span aria-hidden="true" className="find-similar-banner-thumb" />
      )}
      <span className="find-similar-banner-copy">
        <strong>{t("settings.semanticSearch.similarBanner")}</strong>
        {displayName ? <span>{displayName}</span> : null}
      </span>
      <button className="secondary-button" onClick={onBack} type="button">
        {t("settings.semanticSearch.similarBack")}
      </button>
    </div>
  );
}
