import { Router, Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import { requireAuth, uid } from '../middleware/auth';
import { validateSessionOwnership } from '../db/sessions';
import type { Node } from '../assembler/types';

const router = Router();
router.use(requireAuth);

// ─── Helpers ─────────────────────────────────────────────────

const C = {
  dark:    '#111827',
  mid:     '#374151',
  grey:    '#6B7280',
  light:   '#9CA3AF',
  rule:    '#E5E7EB',
  gold:    '#92650A',   // print-safe dark gold
  green:   '#065F46',
};

function rule(doc: PDFKit.PDFDocument, y?: number) {
  const x0 = doc.page.margins.left;
  const x1 = doc.page.width - doc.page.margins.right;
  const ry = y ?? doc.y;
  doc.moveTo(x0, ry).lineTo(x1, ry).strokeColor(C.rule).lineWidth(0.5).stroke();
}

function sectionLabel(doc: PDFKit.PDFDocument, label: string) {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.gold)
     .text(label.toUpperCase(), { characterSpacing: 1.8 });
  doc.moveDown(0.25);
  rule(doc);
  doc.moveDown(0.45);
}

function bullet(doc: PDFKit.PDFDocument, text: string, prefix = '→', color = C.dark) {
  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const prefixW = 14;
  const savedY = doc.y;
  doc.font('Helvetica').fontSize(9).fillColor(C.gold)
     .text(prefix, doc.page.margins.left, savedY, { width: prefixW, lineBreak: false });
  doc.font('Helvetica').fontSize(9.5).fillColor(color)
     .text(text, doc.page.margins.left + prefixW, savedY, { width: W - prefixW, lineGap: 1.5 });
}

// ─── POST /pdf/resume ─────────────────────────────────────────

router.post('/resume', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id } = req.body;
  if (!session_id) { res.status(400).json({ error: 'session_id required' }); return; }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  const graph = (session.graph_data ?? { nodes: [], edges: [] }) as { nodes: Node[]; edges: unknown[] };

  const projection = session.insights?.projection as {
    positioning_statement?: string;
    achievement_bullets?: string[];
    gap_analysis?: {
      strengths?: string[];
      gaps?: Array<{ label: string; description: string; question?: string }>;
      bridge?: string;
    };
    selected_node_ids?: string[];
  } | undefined;

  const portrait  = session.insights?.portrait  as Record<string, string> | undefined;
  const strength  = session.insights?.strength  as { insight?: string; identity_reframe?: string } | undefined;
  const branches  = session.insights?.branches  as Array<{ title: string; description: string }> | undefined;

  // ── Derive resume content ──
  const headline = strength?.identity_reframe || portrait?.identity || '';

  const summary = projection?.positioning_statement
    || (portrait?.identity ? `${portrait.identity}${portrait.rare_factor ? ' ' + portrait.rare_factor : ''}` : '')
    || strength?.insight?.split('.')[0] || '';

  const coreStrengths  = projection?.gap_analysis?.strengths ?? [];
  const achBullets     = projection?.achievement_bullets ?? [];

  const roleNodes = graph.nodes
    .filter(n => n.type === 'role')
    .sort((a, b) => {
      const ay = parseInt(a.year?.match(/(\d{4})\s*[-–]/)?.[ 1] ?? a.year?.match(/(\d{4})$/)?.[1] ?? '0');
      const by = parseInt(b.year?.match(/(\d{4})\s*[-–]/)?.[ 1] ?? b.year?.match(/(\d{4})$/)?.[1] ?? '0');
      return by - ay;
    });

  const skillNodes    = graph.nodes.filter(n => n.type === 'skill' && n.weight >= 2);
  const projectNodes  = graph.nodes.filter(n => (n.type === 'project' || n.type === 'outcome') && n.weight >= 2);
  const decisionNodes = graph.nodes.filter(n => n.type === 'decision' && n.weight === 3);

  // ── Build PDF ──
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 58, bottom: 54, left: 72, right: 72 },
    info: { Title: 'Resume — CareerOS', Creator: 'CareerOS' },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="career-os-resume.pdf"');
  doc.pipe(res);

  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // ── HEADER ──────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(26).fillColor(C.dark)
     .text('[Your Name]', { align: 'left' });

  if (headline) {
    doc.font('Helvetica').fontSize(11).fillColor(C.mid)
       .moveDown(0.15)
       .text(headline, { align: 'left' });
  }

  doc.font('Helvetica').fontSize(9).fillColor(C.light)
     .moveDown(0.25)
     .text('[email]  ·  [phone]  ·  [city, state]  ·  [LinkedIn URL]', { align: 'left' });

  doc.moveDown(0.3);
  rule(doc);
  doc.moveDown(0.8);

  // ── PROFESSIONAL SUMMARY ────────────────────────────────────
  if (summary) {
    sectionLabel(doc, 'Professional Summary');
    doc.font('Helvetica').fontSize(10.5).fillColor(C.dark)
       .text(summary, { align: 'left', lineGap: 3 });
    doc.moveDown(1);
  }

  // ── CORE STRENGTHS ──────────────────────────────────────────
  if (coreStrengths.length) {
    sectionLabel(doc, 'Core Strengths');
    const colW = (W - 16) / 2;
    const mid  = doc.page.margins.left + colW + 16;
    const startY = doc.y;
    let leftY = startY, rightY = startY;

    coreStrengths.forEach((s, i) => {
      const col = i % 2;
      const x   = col === 0 ? doc.page.margins.left : mid;
      const y   = col === 0 ? leftY : rightY;
      const savedY = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(C.green).text('✓', x, y, { width: 12, lineBreak: false });
      doc.font('Helvetica').fontSize(9.5).fillColor(C.dark).text(s, x + 13, y, { width: colW - 13, lineGap: 1.5 });
      const endY = doc.y;
      if (col === 0) leftY = endY + 4;
      else rightY = endY + 4;
      doc.y = Math.max(leftY, rightY);
    });

    doc.y = Math.max(leftY, rightY) + 4;
    doc.moveDown(0.6);
  }

  // ── ACHIEVEMENT HIGHLIGHTS ──────────────────────────────────
  if (achBullets.length) {
    sectionLabel(doc, 'Key Achievements');
    achBullets.forEach(b => {
      bullet(doc, b);
      doc.moveDown(0.25);
    });
    doc.moveDown(0.6);
  }

  // ── PROFESSIONAL EXPERIENCE ─────────────────────────────────
  if (roleNodes.length) {
    sectionLabel(doc, 'Professional Experience');
    roleNodes.forEach(role => {
      // Role title + year on same line
      const titleW = W - 80;
      const savedY = doc.y;
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.dark)
         .text(role.label, doc.page.margins.left, savedY, { width: titleW, lineBreak: false });
      if (role.year) {
        doc.font('Helvetica').fontSize(9).fillColor(C.light)
           .text(role.year, doc.page.margins.left + titleW, savedY, { width: 80, align: 'right', lineBreak: false });
      }
      doc.y = savedY + 14;
      doc.font('Helvetica').fontSize(9.5).fillColor(C.grey)
         .text(role.detail, { lineGap: 2 });
      doc.moveDown(0.65);
    });
    doc.moveDown(0.3);
  }

  // ── KEY SKILLS ──────────────────────────────────────────────
  if (skillNodes.length) {
    sectionLabel(doc, 'Key Skills');
    // Wrap skills into a comma-separated flow
    const skillText = skillNodes.map(n => n.label).join('   ·   ');
    doc.font('Helvetica').fontSize(10).fillColor(C.dark)
       .text(skillText, { lineGap: 3 });
    doc.moveDown(1);
  }

  // ── NOTABLE PROJECTS & OUTCOMES ─────────────────────────────
  if (projectNodes.length) {
    sectionLabel(doc, 'Notable Projects & Outcomes');
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

  // ── CAREER DIRECTIONS (if no projection, show branches) ─────
  if (!projection && branches?.length) {
    sectionLabel(doc, 'Career Directions');
    branches.slice(0, 2).forEach(b => {
      bullet(doc, `${b.title} — ${b.description}`, '◆', C.mid);
      doc.moveDown(0.25);
    });
    doc.moveDown(0.6);
  }

  // ── NOTABLE DECISIONS (weight-3 decision nodes) ──────────────
  if (decisionNodes.length) {
    sectionLabel(doc, 'Key Initiatives');
    decisionNodes.forEach(d => {
      bullet(doc, d.detail, '→', C.dark);
      doc.moveDown(0.2);
    });
  }

  // ── FOOTER ──────────────────────────────────────────────────
  const footerY = doc.page.height - doc.page.margins.bottom - 16;
  doc.font('Helvetica').fontSize(7).fillColor('#CCCCCC')
     .text('Generated by CareerOS', doc.page.margins.left, footerY,
           { width: W, align: 'center' });

  doc.end();
});

export default router;
