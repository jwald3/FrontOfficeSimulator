import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { validateEditorial } from './src/engine/editorialSchema.ts'
import { EMPTY_REPORTS, RESOLUTIONS, resolveReport, validateNewReport, type ReportAction, type ReportsFile } from './src/engine/reportSchema.ts'

/**
 * Dev-server only: the editorial screen saves its choices with POST /__editorial,
 * which validates them and writes public/data/editorial.json so they ship with the
 * next build. Production builds have no such endpoint.
 */
function editorialSave(): Plugin {
  return {
    name: 'editorial-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__editorial', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end()
        }
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          try {
            const data = validateEditorial(JSON.parse(body))
            writeFileSync('public/data/editorial.json', JSON.stringify(data, null, 2) + '\n')
            res.statusCode = 204
            res.end()
          } catch (e) {
            res.statusCode = 400
            res.end(e instanceof Error ? e.message : 'Invalid editorial data')
          }
        })
      })
    },
  }
}

const REPORTS_FILE = 'data/reports.json'

function readReports(): ReportsFile {
  return existsSync(REPORTS_FILE) ? (JSON.parse(readFileSync(REPORTS_FILE, 'utf8')) as ReportsFile) : EMPTY_REPORTS
}

function writeReports(file: ReportsFile) {
  mkdirSync('data', { recursive: true })
  writeFileSync(REPORTS_FILE, JSON.stringify(file, null, 2) + '\n')
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (e) {
        reject(e)
      }
    })
  })
}

function fail(res: ServerResponse, status: number, e: unknown) {
  res.statusCode = status
  res.end(e instanceof Error ? e.message : String(e))
}

/**
 * Dev-server only: offer reports. The game flags an offer with POST /__reports;
 * the editorial Feedback inbox lists them with GET /__reports and resolves one
 * (adjusted, ignored, reopened) with POST /__reports/resolve. They live in
 * data/reports.json, outside public/, so they never ship with the game.
 */
function offerReports(): Plugin {
  return {
    name: 'offer-reports',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__reports', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        try {
          if (req.method === 'GET' && (req.url === '/' || req.url === '')) return res.end(JSON.stringify(readReports()))
          if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')
          const body = await readBody(req)
          const file = readReports()
          if (req.url === '/' || req.url === '') {
            const report = validateNewReport(body)
            if (file.reports.some((r) => r.id === report.id)) return fail(res, 409, 'That offer has already been flagged.')
            const at = new Date().toISOString()
            writeReports({ ...file, reports: [...file.reports, { ...report, status: 'open', history: [{ at, action: 'flagged' }] }] })
            res.statusCode = 201
            return res.end('{}')
          }
          if (req.url === '/resolve') {
            const { id, action, detail } = body as { id: string; action: ReportAction; detail?: string }
            if (!RESOLUTIONS.includes(action)) return fail(res, 400, `Action must be one of: ${RESOLUTIONS.join(', ')}.`)
            const at = new Date().toISOString()
            let found = false
            const reports = file.reports.map((r) => (r.id === id ? ((found = true), resolveReport(r, action, detail, at)) : r))
            if (!found) return fail(res, 404, 'No such report.')
            writeReports({ ...file, reports })
            return res.end(JSON.stringify({ ...file, reports }))
          }
          return fail(res, 404, 'Not found')
        } catch (e) {
          return fail(res, 400, e)
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), editorialSave(), offerReports()],
  // Set BASE_PATH when the site is served from a subfolder, e.g. /front-office/ on GitHub Pages.
  base: process.env.BASE_PATH ?? '/',
  build: {
    rolldownOptions: {
      output: {
        // React and Framer Motion change rarely: a separate chunk stays cached across releases.
        advancedChunks: { groups: [{ name: 'vendor', test: /node_modules[\\/](react|react-dom|scheduler|framer-motion|motion-dom|motion-utils)[\\/]/ }] },
      },
    },
  },
})
