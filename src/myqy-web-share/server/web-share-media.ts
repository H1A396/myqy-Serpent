import { artifactProtocolMimeForExtension } from '../../shared/media-formats';
import type { WorkerCommand } from '../../shared/protocol/requests';
import { workerResultSchema, type WorkerResult } from '../../shared/protocol/responses';
import type { WebShareWorkerClient } from './web-share-data';

export interface ResolvedMedia {
  absolutePath: string;
  mimeType: string;
}

export interface WebShareMediaResolver {
  resolveThumbnail(input: { libraryId: string; assetId: string }): Promise<ResolvedMedia | null>;
  resolveSource(input: {
    libraryId: string;
    assetId: string;
    revisionId: string;
  }): Promise<ResolvedMedia | null>;
  resolveArtifact(input: {
    libraryId: string;
    artifactId: string;
    kind: 'preview' | 'proxy';
  }): Promise<ResolvedMedia | null>;
}

function mimeForPath(absolutePath: string): string {
  const match = /\.([A-Za-z0-9]+)$/u.exec(absolutePath);
  const extension = match === null ? '' : `.${match[1]!.toLowerCase()}`;
  return artifactProtocolMimeForExtension(extension);
}

/**
 * Worker-backed media resolution for the read-only web share. It only asks the
 * Worker to authorize a path; the returned absolute path never leaves Main.
 */
export class WorkerBackedWebShareMedia implements WebShareMediaResolver {
  readonly #client: WebShareWorkerClient;

  constructor(client: WebShareWorkerClient) {
    this.#client = client;
  }

  async #request(command: WorkerCommand): Promise<WorkerResult> {
    return workerResultSchema.parse(await this.#client.request(command));
  }

  async resolveThumbnail(input: {
    libraryId: string;
    assetId: string;
  }): Promise<ResolvedMedia | null> {
    const artifactId = await this.#resolveThumbnailArtifactId(input.libraryId, input.assetId);
    if (artifactId === null) return null;
    return this.#resolveArtifactPath(input.libraryId, artifactId, 'preview');
  }

  /**
   * Resolve an artifact id to an absolute path through the same Worker command
   * the desktop protocol uses. The Worker's `media.thumbnail-artifact.filePath`
   * is relative to `.serpent/artifacts` and must never be served directly:
   * `media.get-artifact-paths` is the boundary that both resolves the absolute
   * path and re-validates containment (Serpent-0cc23f).
   */
  async #resolveArtifactPath(
    libraryId: string,
    artifactId: string,
    usage: 'preview' | 'proxy',
  ): Promise<ResolvedMedia | null> {
    const paths = await this.#request({
      type: 'media.get-artifact-paths',
      libraryId,
      artifactIds: [artifactId],
      usage,
    });
    if (!paths.ok || paths.type !== 'media.artifact-paths') return null;
    const entry = paths.entries.find((candidate) => candidate.artifactId === artifactId);
    return entry === undefined
      ? null
      : { absolutePath: entry.absolutePath, mimeType: mimeForPath(entry.absolutePath) };
  }

  /**
   * `media.get-thumbnail-artifact` carries the artifact id (and a
   * library-relative `filePath` we deliberately ignore). A share visitor may
   * also be the first person to look at an asset, so fall back to generating
   * the derived artifact the same way the desktop viewer does; this only writes
   * a derived cache artifact and never touches the user's asset or metadata.
   */
  async #resolveThumbnailArtifactId(libraryId: string, assetId: string): Promise<string | null> {
    const result = await this.#request({
      type: 'media.get-thumbnail-artifact',
      libraryId,
      assetId,
    });
    if (result.ok && result.type === 'media.thumbnail-artifact') return result.artifactId;
    return this.#generateThumbnailArtifactId(libraryId, assetId);
  }

  async #generateThumbnailArtifactId(libraryId: string, assetId: string): Promise<string | null> {
    try {
      const generated = await this.#request({
        type: 'media.generate-thumbnail',
        libraryId,
        assetId,
      });
      if (
        !generated.ok
        || generated.type !== 'media.thumbnail.generated'
        || generated.artifactId === undefined
      ) {
        return null;
      }
      return generated.artifactId;
    } catch {
      // Slow/failed generation (e.g. a video poster still running) is reported
      // as "not ready" and the client retries.
      return null;
    }
  }

  async resolveSource(input: {
    libraryId: string;
    assetId: string;
    revisionId: string;
  }): Promise<ResolvedMedia | null> {
    const result = await this.#request({
      type: 'media.get-source-path',
      libraryId: input.libraryId,
      assetId: input.assetId,
      revisionId: input.revisionId,
    });
    if (!result.ok || result.type !== 'media.source-path') return null;
    return { absolutePath: result.absolutePath, mimeType: result.mimeType };
  }

  async resolveArtifact(input: {
    libraryId: string;
    artifactId: string;
    kind: 'preview' | 'proxy';
  }): Promise<ResolvedMedia | null> {
    return this.#resolveArtifactPath(input.libraryId, input.artifactId, input.kind);
  }
}
