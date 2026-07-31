import type { ArtifactKind } from '@shared/session'
import type { UiArtifact } from './fences'

export function toUiArtifactKind(kind: ArtifactKind): UiArtifact['kind'] {
  return kind === 'image' ? 'log' : kind
}
