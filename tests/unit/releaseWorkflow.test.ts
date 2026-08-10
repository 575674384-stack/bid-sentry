import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('v1.0.0 release workflow', () => {
  it('rehashes every existing draft asset before allowing a resume', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8')
    expect(workflow).toContain('mapfile -t draft_asset_names')
    expect(workflow).toContain('--pattern "$asset_name"')
    expect(workflow).toContain("createHash('sha256')")
    expect(workflow).toContain('cmp -s existing-release/SHA256SUMS release-assets/final/SHA256SUMS')
    expect(workflow).not.toContain('--clobber')
    expect(workflow).toContain("mapfile -t draft_asset_names < <(jq -r '.assets[]?.name'")
    expect(workflow).not.toContain('test -f existing-release/release-manifest.json')
    expect(workflow).not.toContain('test "${#draft_asset_names[@]}" -gt 0')
  })

  it('normalizes draft metadata and fills partial uploads without overwriting bytes', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8')
    expect(workflow).toContain('--json isDraft,isPrerelease,title,body,assets')
    expect(workflow).toContain(
      'gh release edit v1.0.0 --repo "$GITHUB_REPOSITORY" --draft --title \'Bid Sentry v1.0.0\''
    )
    expect(workflow).toContain('missing_assets=()')
    expect(workflow).toContain('Unexpected existing draft asset')
    expect(workflow).toContain(
      'if [[ -f existing-release/SHA256SUMS ]]; then cmp -s existing-release/SHA256SUMS release-assets/final/SHA256SUMS; fi'
    )
  })
})
