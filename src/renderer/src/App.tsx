export function App(): React.JSX.Element {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="app-title">
        <p className="eyebrow">本地优先 · 原文件只读</p>
        <h1 id="app-title">Bid Sentry</h1>
        <p className="subtitle">文档安全助手</p>
        <p className="description">
          安全重置 DOCX/PDF 隐藏元数据，并在输出前验证文档内容没有发生意外变化。
        </p>
      </section>
      <section className="status-card" aria-label="项目状态">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <strong>基础环境已就绪</strong>
          <p>清洗、审查和资格标制作能力将按里程碑逐步开放。</p>
        </div>
      </section>
    </main>
  )
}
