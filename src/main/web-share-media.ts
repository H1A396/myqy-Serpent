import { artifactProtocolMimeForExtension } from '../shared/media-formats';
import type { WorkerCommand } from '../shared/protocol/requests';
import { workerResultSchema, type WorkerResult } from '../shared/protocol/responses';
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
    const result = await this.#request({
      type: 'media.get-thumbnail-artifact',
      libraryId: input.libraryId,
      assetId: input.assetId,
    });
    if (result.ok && result.type === 'media.thumbnail-artifact') {
      return { absolutePath: result.filePath, mimeType: mimeForPath(result.filePath) };
    }
    return this.#generateThumbnail(input.libraryId, input.assetId);
  }

  /**
   * A share visitor may be the first person to look at an asset, so the
   * thumbnail artifact can still be absent. Generate it on demand the same way
   * the desktop viewer does; this only writes a derived cache artifact and
   * never touches the user's asset or metadata.
   */
  async #generateThumbnail(libraryId: string, assetId: string): Promise<ResolvedMedia | null> {
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
      const paths = await this.#request({
        type: 'media.get-artifact-paths',
        libraryId,
        artifactIds: [generated.artifactId],
        usage: 'preview',
      });
      if (!paths.ok || paths.type !== 'media.artifact-paths') return null;
      const entry = paths.entries.find(
        (candidate) => candidate.artifactId === generated.artifactId,
      );
      return entry === undefined
        ? null
        : { absolutePath: entry.absolutePath, mimeType: mimeForPath(entry.absolutePath) };
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
    const result = await this.#request({
      type: 'media.get-artifact-paths',
      libraryId: input.libraryId,
      artifactIds: [input.artifactId],
      usage: input.kind,
    });
    if (!result.ok || result.type !== 'media.artifact-paths') return null;
    const entry = result.entries.find((candidate) => candidate.artifactId === input.artifactId);
    if (entry === undefined) return null;
    return { absolutePath: entry.absolutePath, mimeType: mimeForPath(entry.absolutePath) };
  }
}
