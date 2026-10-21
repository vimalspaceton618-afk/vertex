import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { Tool } from './Tool.js';

export class DocumentWriterTool extends Tool {
    name = "document_writer";
    description = "Create formatted documents in PDF, DOCX, HTML, or Markdown formats. For PDF, converts rich HTML/CSS content into clean PDF files. For DOCX, outputs Word-compatible formatted XML/HTML documents.";
    schema = {
        type: "object",
        properties: {
            format: {
                type: "string",
                enum: ["pdf", "docx", "html", "md"],
                description: "Target document format to generate."
            },
            outputPath: {
                type: "string",
                description: "Absolute or relative output file path (e.g. E:/report.pdf or ./output.docx)."
            },
            title: {
                type: "string",
                description: "Document title."
            },
            content: {
                type: "string",
                description: "Body content (Markdown or HTML format)."
            },
            headerFooter: {
                type: "boolean",
                description: "Include default header/footer with page numbers for PDF."
            }
        },
        required: ["format", "outputPath", "content"]
    };

    async execute(args: any): Promise<string> {
        const { format, outputPath, title = "Document", content, headerFooter = true } = args;
        const resolvedPath = path.resolve(process.cwd(), outputPath);
        const dir = path.dirname(resolvedPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const lowerFormat = format.toLowerCase();

        if (lowerFormat === 'md') {
            const mdContent = title ? `# ${title}\n\n${content}` : content;
            fs.writeFileSync(resolvedPath, mdContent, 'utf-8');
            return `Markdown document generated successfully: ${resolvedPath}`;
        }

        const htmlBody = content.startsWith('<') ? content : markdownToSimpleHtml(title, content);

        if (lowerFormat === 'html') {
            fs.writeFileSync(resolvedPath, htmlBody, 'utf-8');
            return `HTML document generated successfully: ${resolvedPath}`;
        }

        if (lowerFormat === 'pdf') {
            try {
                const browser = await puppeteer.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
                const page = await browser.newPage();
                await page.setContent(htmlBody, { waitUntil: 'load' });
                await page.pdf({
                    path: resolvedPath,
                    format: 'A4',
                    printBackground: true,
                    displayHeaderFooter: headerFooter,
                    headerTemplate: `<div style="font-size: 9px; width: 100%; text-align: center; color: #888;">${title}</div>`,
                    footerTemplate: '<div style="font-size: 9px; width: 100%; text-align: center; color: #888;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
                    margin: { top: '60px', bottom: '60px', left: '40px', right: '40px' }
                });
                await browser.close();
                return `PDF document generated successfully: ${resolvedPath}`;
            } catch (err: any) {
                return `[PDF GENERATION ERROR]: ${err.message}`;
            }
        }

        if (lowerFormat === 'docx') {
            // Word HTML envelope for clean DOCX opening
            const wordEnvelope = `
                <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
                <head><meta charset='utf-8'><title>${title}</title>
                <!--[if gte mso 9]>
                <xml>
                <w:WordDocument>
                <w:View>Print</w:View>
                <w:Zoom>100</w:Zoom>
                <w:DoNotOptimizeForBrowser/>
                </w:WordDocument>
                </xml>
                <![endif]-->
                <style>
                body { font-family: 'Calibri', 'Segoe UI', Arial, sans-serif; margin: 1in; font-size: 11pt; line-height: 1.5; color: #222; }
                h1 { color: #003366; font-size: 20pt; border-bottom: 2px solid #003366; padding-bottom: 4px; }
                h2 { color: #004080; font-size: 15pt; margin-top: 18px; }
                h3 { color: #333333; font-size: 12pt; margin-top: 12px; }
                code, pre { font-family: 'Consolas', 'Courier New', monospace; background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
                pre { padding: 10px; background: #2d2d2d; color: #f8f8f2; overflow-x: auto; }
                table { border-collapse: collapse; width: 100%; margin: 14px 0; }
                th, td { border: 1px solid #cccccc; padding: 8px 12px; text-align: left; }
                th { background-color: #003366; color: white; }
                tr:nth-child(even) { background-color: #f9f9f9; }
                blockquote { border-left: 4px solid #003366; margin: 10px 0; padding-left: 10px; color: #555; }
                </style>
                </head>
                <body>
                ${htmlBody}
                </body>
                </html>
            `;
            const docxPath = resolvedPath.endsWith('.docx') ? resolvedPath : `${resolvedPath}.docx`;
            fs.writeFileSync(docxPath, wordEnvelope, 'utf-8');
            return `Word document (.docx) generated successfully: ${docxPath}`;
        }

        return `Unsupported format: ${format}. Supported formats: pdf, docx, html, md.`;
    }
}

function markdownToSimpleHtml(title: string, markdown: string): string {
    let body = markdown
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n\n/g, '</p><p>');

    body = `<p>${body}</p>`;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 800px; margin: 0 auto; padding: 40px 20px; }
  h1 { font-size: 2.2rem; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 24px; }
  h2 { font-size: 1.5rem; color: #1e293b; margin-top: 28px; margin-bottom: 12px; }
  h3 { font-size: 1.2rem; color: #334155; margin-top: 20px; margin-bottom: 8px; }
  p { margin-bottom: 14px; font-size: 1rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  pre { background: #0f172a; color: #f8fafc; padding: 16px; border-radius: 8px; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  blockquote { border-left: 4px solid #3b82f6; padding-left: 16px; color: #475569; margin: 16px 0; font-style: italic; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  th, td { border: 1px solid #cbd5e1; padding: 10px 14px; text-align: left; }
  th { background-color: #f8fafc; font-weight: 600; }
  tr:nth-child(even) { background-color: #f1f5f9; }
</style>
</head>
<body>
  ${title ? `<h1>${title}</h1>` : ''}
  ${body}
</body>
</html>`;
}
