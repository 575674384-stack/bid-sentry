import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInputSnapshot } from '../../src/core/documents/fileSafety'
import { ReviewTaskManager } from '../../src/main/tasks/reviewTaskManager'
import { MemorySecretStore } from '../../src/main/settings/secretStore'
import { SettingsService } from '../../src/main/settings/settingsService'
import { readDocumentSnapshot } from '../../src/core/documents/documentReader'
import { resolvePathIdentityWithoutSymbolicLinks } from '../../src/core/documents/pathSafety'
import { renderReviewReportHtml } from '../../src/core/review/report'
import { writeDocxFixture } from '../fixtures/builders/docxFixture'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('ReviewTaskManager verified publication', () => {
  it('reads frozen inputs and publishes reports only after workspace verification', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-review-task-'))
    directories.push(directory)
    const tenderPath = join(directory, 'tender.docx')
    const bidPath = join(directory, 'bid.docx')
    await writeDocxFixture(tenderPath)
    await writeDocxFixture(bidPath)
    const tender = await createInputSnapshot(tenderPath)
    const bid = await createInputSnapshot(bidPath)
    const beforeTender = await readFile(tenderPath)
    const beforeBid = await readFile(bidPath)
    const outputDirectoryIdentity = (await resolvePathIdentityWithoutSymbolicLinks(directory))
      .identity
    const recorded: string[] = []
    const forgotten: string[] = []
    const manager = new ReviewTaskManager({
      recordWorkspace: async (workspace) => {
        recorded.push(workspace.rootPath)
      },
      forgetWorkspace: async (workspace) => {
        forgotten.push(workspace.rootPath)
      }
    })
    const result = await manager.run(
      {
        schemaVersion: 1,
        taskId: '423e4567-e89b-42d3-a456-426614174000',
        tenderInputId: '123e4567-e89b-42d3-a456-426614174000',
        bidInputId: '223e4567-e89b-42d3-a456-426614174000',
        bidderName: '示例投标单位',
        aiConfirmed: false
      },
      tender,
      bid,
      directory,
      outputDirectoryIdentity
    )
    expect(result.report.status).toBe('completed')
    expect(await readFile(join(directory, result.jsonReport), 'utf8')).toContain(
      '"schemaVersion": 1'
    )
    expect(await readFile(join(directory, result.htmlReport), 'utf8')).toBe(
      renderReviewReportHtml(result.report.findings)
    )
    expect(await readFile(tenderPath)).toEqual(beforeTender)
    expect(await readFile(bidPath)).toEqual(beforeBid)
    expect(recorded).toHaveLength(5)
    expect(forgotten).toEqual([recorded.at(-1)])
    expect((await readdir(directory)).some((name) => name.startsWith('.bid-sentry-tmp-'))).toBe(
      false
    )
  })

  it('rejects a source changed after selection before any report is published', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-review-changed-'))
    directories.push(directory)
    const tenderPath = join(directory, 'tender.docx')
    const bidPath = join(directory, 'bid.docx')
    await writeDocxFixture(tenderPath)
    await writeDocxFixture(bidPath)
    const tender = await createInputSnapshot(tenderPath)
    const bid = await createInputSnapshot(bidPath)
    const outputDirectoryIdentity = (await resolvePathIdentityWithoutSymbolicLinks(directory))
      .identity
    await writeFile(bidPath, Buffer.concat([await readFile(bidPath), Buffer.from('\nchanged')]))
    const manager = new ReviewTaskManager()
    await expect(
      manager.run(
        {
          schemaVersion: 1,
          taskId: '523e4567-e89b-42d3-a456-426614174000',
          tenderInputId: '123e4567-e89b-42d3-a456-426614174000',
          bidInputId: '223e4567-e89b-42d3-a456-426614174000',
          bidderName: '示例投标单位',
          aiConfirmed: false
        },
        tender,
        bid,
        directory,
        outputDirectoryIdentity
      )
    ).rejects.toMatchObject({ appError: { code: 'FILE_CHANGED' } })
    expect((await readdir(directory)).filter((name) => name.startsWith('bid-review-'))).toEqual([])
  })

  it('drops AI findings whose excerpts are not present in the cited nodes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-review-ai-grounding-'))
    directories.push(directory)
    const tenderPath = join(directory, 'tender.docx')
    const bidPath = join(directory, 'bid.docx')
    const settingsPath = join(directory, 'settings.v2.json')
    await writeDocxFixture(tenderPath)
    await writeDocxFixture(bidPath)
    const tender = await createInputSnapshot(tenderPath)
    const bid = await createInputSnapshot(bidPath)
    const outputDirectoryIdentity = (await resolvePathIdentityWithoutSymbolicLinks(directory))
      .identity
    const tenderDocument = await readDocumentSnapshot(tenderPath, 'docx')
    const bidDocument = await readDocumentSnapshot(bidPath, 'docx')
    const response = {
      findings: [
        {
          id: 'c'.repeat(24),
          type: 'ai-suggestion',
          severity: 'needs-review',
          confidence: 0.8,
          summary: '伪造证据',
          tenderEvidence: [
            {
              document: 'tender',
              nodeId: tenderDocument.nodes[0]!.nodeId,
              label: '招标',
              excerpt: '不存在的招标摘录'
            }
          ],
          bidEvidence: [
            {
              document: 'bid',
              nodeId: bidDocument.nodes[0]!.nodeId,
              label: '投标',
              excerpt: '不存在的投标摘录'
            }
          ],
          suggestion: '请人工核对。',
          source: 'ai',
          status: 'open'
        }
      ]
    }
    const settingsService = new SettingsService(settingsPath, new MemorySecretStore())
    await settingsService.save({
      schemaVersion: 1,
      baseUrl: 'https://api.example.com/v1',
      model: 'synthetic',
      timeoutMs: 5_000,
      maxConcurrency: 1,
      closeToTray: false,
      checkUpdatesOnStartup: true,
      outputMode: 'suffix',
      outputSuffix: '_已清洗',
      companyProfile: {
        bidderName: '',
        unifiedSocialCreditCode: '',
        address: '',
        legalRepresentative: '',
        authorizedRepresentative: '',
        contact: '',
        phone: '',
        email: ''
      },
      apiKey: 'synthetic-key',
      clearApiKey: false
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }),
            { status: 200 }
          )
      )
    )
    try {
      const result = await new ReviewTaskManager({ settingsService }).run(
        {
          schemaVersion: 1,
          taskId: '623e4567-e89b-42d3-a456-426614174000',
          tenderInputId: '123e4567-e89b-42d3-a456-426614174000',
          bidInputId: '223e4567-e89b-42d3-a456-426614174000',
          bidderName: '示例投标单位',
          aiConfirmed: true
        },
        tender,
        bid,
        directory,
        outputDirectoryIdentity
      )
      expect(result.report.aiCount).toBe(0)
      expect(result.report.findings).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('requests one correction when an AI chunk response is not valid JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bid-sentry-review-ai-correction-'))
    directories.push(directory)
    const tenderPath = join(directory, 'tender.docx')
    const bidPath = join(directory, 'bid.docx')
    const settingsPath = join(directory, 'settings.v2.json')
    await writeDocxFixture(tenderPath)
    await writeDocxFixture(bidPath)
    const tender = await createInputSnapshot(tenderPath)
    const bid = await createInputSnapshot(bidPath)
    const tenderDocument = await readDocumentSnapshot(tenderPath, 'docx')
    const bidDocument = await readDocumentSnapshot(bidPath, 'docx')
    const finding = {
      id: 'd'.repeat(24),
      type: 'ai-suggestion' as const,
      severity: 'needs-review' as const,
      confidence: 0.6,
      summary: '需要人工复核',
      tenderEvidence: [
        {
          document: 'tender' as const,
          nodeId: tenderDocument.nodes[0]!.nodeId,
          label: '招标',
          excerpt: tenderDocument.nodes[0]!.text
        }
      ],
      bidEvidence: [
        {
          document: 'bid' as const,
          nodeId: bidDocument.nodes[0]!.nodeId,
          label: '投标',
          excerpt: bidDocument.nodes[0]!.text
        }
      ],
      suggestion: '请人工核对。',
      source: 'ai' as const,
      status: 'open' as const
    }
    const settingsService = new SettingsService(settingsPath, new MemorySecretStore())
    await settingsService.save({
      schemaVersion: 1,
      baseUrl: 'https://api.example.com/v1',
      model: 'synthetic',
      timeoutMs: 5_000,
      maxConcurrency: 1,
      closeToTray: false,
      checkUpdatesOnStartup: true,
      outputMode: 'suffix',
      outputSuffix: '_已清洗',
      companyProfile: {
        bidderName: '',
        unifiedSocialCreditCode: '',
        address: '',
        legalRepresentative: '',
        authorizedRepresentative: '',
        contact: '',
        phone: '',
        email: ''
      },
      apiKey: 'synthetic-key',
      clearApiKey: false
    })
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        const content = calls === 1 ? 'not-json' : JSON.stringify({ findings: [finding] })
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
          status: 200
        })
      })
    )
    try {
      const outputDirectoryIdentity = (await resolvePathIdentityWithoutSymbolicLinks(directory))
        .identity
      const result = await new ReviewTaskManager({ settingsService }).run(
        {
          schemaVersion: 1,
          taskId: '723e4567-e89b-42d3-a456-426614174000',
          tenderInputId: '123e4567-e89b-42d3-a456-426614174000',
          bidInputId: '223e4567-e89b-42d3-a456-426614174000',
          bidderName: '示例投标单位',
          aiConfirmed: true
        },
        tender,
        bid,
        directory,
        outputDirectoryIdentity
      )
      expect(calls).toBe(2)
      expect(result.report.aiCount).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
