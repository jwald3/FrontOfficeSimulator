import { useEffect, useState } from 'react'
import { renderShareCard, type ShareCardData } from './shareCard'

// ─── Sharing ────────────────────────────────────────────────────────────────

export function SharePanel({ data }: { data: ShareCardData }) {
  const [url, setUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const link = `${location.origin}${location.pathname}?run=${data.code}`

  useEffect(() => {
    let objectUrl: string | null = null
    let live = true
    renderShareCard(data)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (live) setUrl(objectUrl)
      })
      .catch(() => live && setStatus('The share card could not be drawn.'))
    return () => {
      live = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [data])

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus(done)
    } catch {
      setStatus('Copy failed. Select the code and copy it by hand.')
    }
  }

  return (
    <section className="share">
      <div className="eyebrow">Challenge your friends</div>
      <p className="muted">
        Anyone who enters this code plays your exact offseason: the same free agents, draft class and league moves. See who grades higher.
      </p>
      <div className="share-code display">{data.code}</div>
      <div className="share-actions">
        <button className="btn" onClick={() => copy(link, 'Challenge link copied.')}>Copy challenge link</button>
        <button className="btn ghost" onClick={() => copy(data.code, 'Code copied.')}>Copy code</button>
        {url && (
          <a className="btn ghost" href={url} download={`front-office-${data.code}.png`}>
            Download share card
          </a>
        )}
      </div>
      {status && <div className="share-status muted" role="status">{status}</div>}
      {url && <img className="share-preview" src={url} alt="Share card with your grade, projection and challenge code" />}
    </section>
  )
}
