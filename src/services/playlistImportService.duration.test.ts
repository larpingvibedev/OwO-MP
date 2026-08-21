import { extractDurationFromLockupViewModel } from './playlistImportService';

export function runPlaylistDurationParserFixtures(): Array<{ name: string; duration: number }> {
  const fixtures = [
    {
      name: 'title token does not beat overlay',
      expected: 225,
      lockup: {
        metadata: { lockupMetadataViewModel: { title: { content: 'Song 1:23' } } },
        contentImage: {
          thumbnailViewModel: {
            overlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: '3:45' } } }]
          }
        }
      }
    },
    {
      name: 'title-only token is not duration',
      expected: 0,
      lockup: {
        metadata: { lockupMetadataViewModel: { title: { content: 'Song 1:23' } } }
      }
    },
    {
      name: 'metadata duration part',
      expected: 225,
      lockup: {
        metadata: {
          lockupMetadataViewModel: {
            title: { content: 'Song 1:23' },
            metadata: {
              contentMetadataViewModel: {
                metadataRows: [{ metadataParts: [{ text: { content: 'Artist' } }, { text: { content: '3:45' } }] }]
              }
            }
          }
        }
      }
    },
    {
      name: 'artist seconds phrase is not duration',
      expected: 0,
      lockup: {
        accessibility: { accessibilityData: { label: 'Song by 5 Seconds of Summer' } }
      }
    },
    {
      name: 'duration milliseconds are normalized',
      expected: 225,
      lockup: { durationMs: 225000 }
    },
    {
      name: 'duration millis are normalized',
      expected: 225,
      lockup: { durationMillis: 225000 }
    },
    {
      name: 'milliseconds are normalized',
      expected: 225,
      lockup: { milliseconds: 225000 }
    },
    {
      name: 'ambiguous numeric duration is ignored',
      expected: 0,
      lockup: { duration: 225000 }
    }
  ];

  return fixtures.map(fixture => {
    const duration = extractDurationFromLockupViewModel(fixture.lockup);
    if (duration !== fixture.expected) {
      throw new Error(`${fixture.name}: expected ${fixture.expected}, received ${duration}`);
    }
    return { name: fixture.name, duration };
  });
}
