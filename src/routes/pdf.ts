import { Router, Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import { requireAuth, uid } from '../middleware/auth';
import { validateSessionOwnership } from '../db/sessions';
import {
  saveResumeVersion,
  listResumeVersions,
  getResumeVersion,
  renameResumeVersion,
  deleteResumeVersion,
} from '../db/resumeVersions';
import type { Node } from '../assembler/types';

const router = Router();
router.use(requireAuth);

// ─── Colour palette ──────────────────────────────────────────

const C = {
  dark:  '#111827',
  mid:   '#374151',
  grey:  '#6B7280',
  light: '#9CA3AF',
  rule:  '#E5E7EB',
  gold:  '#92650A',   // print-safe dark gold
  green: '#065F46',
};

// ─── PDF builder (snapshot → Buffer) ─────────────────────────

interface ResumeSnapshot {
  nodes: Node[];
  projection?: {
    positioning_statement?: string;
    achievement_bullets?: string[];
    gap_analysis?: {
      strengths?: string[];
      gaps?: Array<{ label: string; description: string; question?: string }>;
      bridge?: string;
    };
  };
  portrait?: Record<string, string>;
  strength?: { insight?: string; identity_reframe?: string };
  branches?: Array<{ title: string; description: string }>;
}

async function buildResumePDF(snapshot: ResumeSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 58, bottom: 54, left: 72, right: 72 },
      info: { Title: 'Resume — CareerOS', Creator: 'CareerOS' },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // helpers
    function rule() {
      const x0 = doc.page.margins.left, x1 = doc.page.width - doc.page.margins.right;
      doc.moveTo(x0, doc.y).lineTo(x1, doc.y).strokeColor(C.rule).lineWidth(0.5).stroke();
    }

    function section(label: string) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.gold)
         .text(label.toUpperCase(), { characterSpacing: 1.8 });
      doc.moveDown(0.25); rule(); doc.moveDown(0.45);
    }

    function bullet(text: string, prefix = '→', textColor = C.dark) {
      const px = doc.page.margins.left;
      const savedY = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(C.gold)
         .text(prefix, px, savedY, { width: 14, lineBreak: false });
      doc.font('Helvetica').fontSize(9.5).fillColor(textColor)
         .text(text, px + 14, savedY, { width: W - 14, lineGap: 1.5 });
    }

    const { nodes = [], projection, portrait, strength, branches } = snapshot;

    const headline   = strength?.identity_reframe || portrait?.identity || '';
    const summary    = projection?.positioning_statement
      || (portrait?.identity
          ? `${portrait.identity}${portrait.rare_factor ? ' ' + portrait.rare_factor : ''}`
          : '')
      || strength?.insight?.split('.')[0]
      || '';
    const strengths  = projection?.gap_analysis?.strengths ?? [];
    const achBullets = projection?.achievement_bullets ?? [];

    const roleNodes = nodes
      .filter(n => n.type === 'role')
      .sort((a, b) => {
        const ay = parseInt(a.year?.match(/(\d{4})/)?.[1] ?? '0');
        const by = parseInt(b.year?.match(/(\d{4})/)?.[1] ?? '0');
        return by - ay;
      });
    const skillNodes    = nodes.filter(n => n.type === 'skill' && n.weight >= 2);
    const projectNodes  = nodes.filter(n => (n.type === 'project' || n.type === 'outcome') && n.weight >= 2);
    const decisionNodes = nodes.filter(n => n.type === 'decision' && n.weight === 3);

    // ── HEADER ────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(26).fillColor(C.dark).text('[Your Name]');
    if (headline) {
      doc.font('Helvetica').fontSize(11).fillColor(C.mid).moveDown(0.15).text(headline);
    }
    doc.font('Helvetica').fontSize(9).fillColor(C.light)
       .moveDown(0.25)
       .text('[email]  ·  [phone]  ·  [city, state]  ·  [LinkedIn URL]');
    doc.moveDown(0.3);
    rule(); doc.moveDown(0.8);

    // ── PROFESSIONAL SUMMARY ──────────────────────────────────
    if (summary) {
      section('Professional Summary');
      doc.font('Helvetica').fontSize(10.5).fillColor(C.dark)
         .text(summary, { align: 'left', lineGap: 3 });
      doc.moveDown(1);
    }

    // ── CORE STRENGTHS (2-col) ────────────────────────────────
    if (strengths.length) {
      section('Core Strengths');
      const colW = (W - 16) / 2;
      const midX = doc.page.margins.left + colW + 16;
      let lY = doc.y, rY = doc.y;
      strengths.forEach((s, i) => {
        const col = i % 2, x = col === 0 ? doc.page.margins.left : midX, y = col === 0 ? lY : rY;
        doc.font('Helvetica').fontSize(9).fillColor(C.green).text('✓', x, y, { width: 12, lineBreak: false });
        doc.font('Helvetica').fontSize(9.5).fillColor(C.dark).text(s, x + 13, y, { width: colW - 13, lineGap: 1.5 });
        if (col === 0) lY = doc.y + 4; else rY = doc.y + 4;
        doc.y = Math.max(lY, rY);
      });
      doc.y = Math.max(lY, rY) + 4;
      doc.moveDown(0.6);
    }

    // ── ACHIEVEMENT HIGHLIGHTS ────────────────────────────────
    if (achBullets.length) {
      section('Key Achievements');
      achBullets.forEach(b => { bullet(b); doc.moveDown(0.25); });
      doc.moveDown(0.6);
    }

    // ── PROFESSIONAL EXPERIENCE ───────────────────────────────
    if (roleNodes.length) {
      section('Professional Experience');
      roleNodes.forEach(role => {
        const savedY = doc.y;
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.dark)
           .text(role.label, doc.page.margins.left, savedY, { width: W - 80, lineBreak: false });
        if (role.year) {
          doc.font('Helvetica').fontSize(9).fillColor(C.light)
             .text(role.year, doc.page.margins.left + W - 80, savedY, { width: 80, align: 'right', lineBreak: false });
        }
        doc.y = savedY + 14;
        doc.font('Helvetica').fontSize(9.5).fillColor(C.grey).text(role.detail, { lineGap: 2 });
        doc.moveDown(0.65);
      });
      doc.moveDown(0.3);
    }

    // ── KEY SKILLS ────────────────────────────────────────────
    if (skillNodes.length) {
      section('Key Skills');
      doc.font('Helvetica').fontSize(10).fillColor(C.dark)
         .text(skillNodes.map(n => n.label).join('   ·   '), { lineGap: 3 });
      doc.moveDown(1);
    }

    // ── NOTABLE PROJECTS & OUTCOMES ───────────────────────────
    if (projectNodes.length) {
      section('Notable Projects & Outcomes');
      projectNodes.forEach(p => {
        const savedY = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark)
           .text(p.label, doc.page.margins.left, savedY, { width: 150, lineBreak: false });
        doc.font('Helvetica').fontSize(9.5).fillColor(C.grey)
           .text(p.detail, doc.page.margins.left + 156, savedY, { width: W - 156, lineGap: 2 });
        doc.moveDown(0.35);
      });
      doc.moveDown(0.6);
    }

    // ── KEY INITIATIVES (weight-3 decisions) ─────────────────
    if (decisionNodes.length) {
      section('Key Initiatives');
      decisionNodes.forEach(d => { bullet(d.detail); doc.moveDown(0.2); });
      doc.moveDown(0.4);
    }

    // ── CAREER DIRECTIONS (when no projection) ────────────────
    if (!projection && branches?.length) {
      section('Career Directions');
      branches.slice(0, 2).forEach(b => { bullet(`${b.title} — ${b.description}`, '◆', C.mid); doc.moveDown(0.25); });
    }

    // ── FOOTER ───────────────────────────────────────────────
    doc.font('Helvetica').fontSize(7).fillColor('#CCCCCC')
       .text('Generated by CareerOS',
             doc.page.margins.left,
             doc.page.height - doc.page.margins.bottom - 16,
             { width: W, align: 'center' });

    doc.end();
  });
}

// ─── Snapshot builder from session ───────────────────────────

function snapshotFromSession(session: Record<string, unknown>): ResumeSnapshot {
  const graph = (session.graph_data ?? { nodes: [], edges: [] }) as { nodes: Node[] };
  const insights = (session.insights ?? {}) as Record<string, unknown>;
  return {
    nodes: graph.nodes,
    projection: insights.projection as ResumeSnapshot['projection'],
    portrait:   insights.portrait   as ResumeSnapshot['portrait'],
    strength:   insights.strength   as ResumeSnapshot['strength'],
    branches:   insights.branches   as ResumeSnapshot['branches'],
  };
}

// ─── POST /pdf/resume ─────────────────────────────────────────
// Generate, save version, return PDF stream + X-Version-* headers

router.post('/resume', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, name } = req.body as { session_id?: string; name?: string };
  if (!session_id) { res.status(400).json({ error: 'session_id required' }); return; }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  const snapshot = snapshotFromSession(session as Record<string, unknown>);
  const versionName = (name ?? '').trim() || 'Resume';

  try {
    const [pdf, version] = await Promise.all([
      buildResumePDF(snapshot),
      saveResumeVersion(userId, session_id, versionName, snapshot as unknown as Record<string, unknown>),
    ]);

    if (version) {
      res.setHeader('X-Version-Id',   version.id);
      res.setHeader('X-Version-Name', encodeURIComponent(version.name));
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${versionName.replace(/[^a-z0-9_\-. ]/gi, '_')}.pdf"`);
    res.end(pdf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'pdf generation failed';
    res.status(500).json({ error: msg });
  }
});

// ─── GET /pdf/versions ────────────────────────────────────────
// List all saved versions for the current user (no snapshot payload)

router.get('/versions', async (req: Request, res: Response) => {
  const userId = uid(req);
  try {
    const versions = await listResumeVersions(userId);
    res.json({ versions });
  } catch (err) {
    res.status(500).json({ error: 'failed to list versions' });
  }
});

// ─── GET /pdf/versions/:id/download ──────────────────────────
// Re-download a specific saved version (regenerated from stored snapshot)

router.get('/versions/:id/download', async (req: Request, res: Response) => {
  const userId = uid(req);
  const version = await getResumeVersion(req.params.id as string, userId);
  if (!version) { res.status(404).json({ error: 'Version not found' }); return; }

  try {
    const pdf = await buildResumePDF(version.snapshot as unknown as ResumeSnapshot);
    const safeName = version.name.replace(/[^a-z0-9_\-. ]/gi, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.end(pdf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'pdf generation failed';
    res.status(500).json({ error: msg });
  }
});

// ─── PATCH /pdf/versions/:id/name ────────────────────────────
// Rename a version

router.patch('/versions/:id/name', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return; }

  const ok = await renameResumeVersion(req.params.id as string, userId, name.trim());
  if (!ok) { res.status(404).json({ error: 'Version not found or rename failed' }); return; }
  res.json({ ok: true, id: req.params.id, name: name.trim() });
});

// ─── DELETE /pdf/versions/:id ─────────────────────────────────

router.delete('/versions/:id', async (req: Request, res: Response) => {
  const userId = uid(req);
  const ok = await deleteResumeVersion(req.params.id as string, userId);
  res.json({ ok });
});

export default router;
