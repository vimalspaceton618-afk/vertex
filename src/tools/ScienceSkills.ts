import { Tool } from './Tool.js';
import { SharedContext } from '../core/agent/SharedContext.js';

// ---------------------------------------------------------------------------
// NCBI Sequence Fetch Tool
// ---------------------------------------------------------------------------
export class NcbiFetchTool extends Tool {
    name = 'ncbi_fetch';
    description = 'Fetch nucleotide or protein sequences from NCBI by accession ID.';
    schema = {
        type: 'object',
        properties: {
            db: { type: 'string', enum: ['nuccore', 'protein'], default: 'nuccore', description: 'Database to query' },
            id: { type: 'string', description: 'NCBI accession ID (e.g., NM_000546)' }
        },
        required: ['id']
    };

    async execute(args: any): Promise<string> {
        const db = args.db || 'nuccore';
        const id = args.id;
        const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=${db}&id=${id}&rettype=fasta&retmode=text`;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`NCBI returned status ${res.status}`);
            const text = await res.text();
            SharedContext.appendAudit({ event: 'ncbi_fetch', db, id });
            return text.slice(0, 5000) + (text.length > 5000 ? '\n... [truncated]' : '');
        } catch (e: any) {
            return `[NCBI FETCH ERROR]: ${e.message}`;
        }
    }
}

// ---------------------------------------------------------------------------
// UniProt Fetch Tool
// ---------------------------------------------------------------------------
export class UniProtFetchTool extends Tool {
    name = 'uniprot_fetch';
    description = 'Retrieve protein metadata and details from UniProt by Accession ID.';
    schema = {
        type: 'object',
        properties: {
            accession: { type: 'string', description: 'UniProt Accession ID (e.g., P53_HUMAN or P04637)' }
        },
        required: ['accession']
    };

    async execute(args: any): Promise<string> {
        const acc = args.accession;
        const url = `https://rest.uniprot.org/uniprotkb/${acc}.json`;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`UniProt returned status ${res.status}`);
            const data = await res.json();
            SharedContext.appendAudit({ event: 'uniprot_fetch', accession: acc });
            
            const proteinName = data.proteinDescription?.recommendedName?.fullName?.value || 'Unknown';
            const geneName = data.genes?.[0]?.geneName?.value || 'Unknown';
            const organism = data.organism?.scientificName || 'Unknown';
            const sequence = data.sequence?.value || '';

            return [
                `[UNIPROT RECORD] ${acc}`,
                `  Name:      ${proteinName}`,
                `  Gene:      ${geneName}`,
                `  Organism:  ${organism}`,
                `  Length:    ${sequence.length} AA`,
                `  Sequence (first 100 AA): ${sequence.slice(0, 100)}...`
            ].join('\n');
        } catch (e: any) {
            return `[UNIPROT FETCH ERROR]: ${e.message}`;
        }
    }
}

// ---------------------------------------------------------------------------
// PubChem Search Tool
// ---------------------------------------------------------------------------
export class PubChemSearchTool extends Tool {
    name = 'pubchem_search';
    description = 'Search PubChem for chemical compounds by name and return compound properties.';
    schema = {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Compound name (e.g., aspirin, caffeine)' }
        },
        required: ['name']
    };

    async execute(args: any): Promise<string> {
        const name = encodeURIComponent(args.name);
        const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${name}/property/IUPACName,MolecularFormula,MolecularWeight,CanonicalSMILES/JSON`;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`PubChem returned status ${res.status}`);
            const data = await res.json();
            const prop = data.PropertyTable?.Properties?.[0];
            if (!prop) return `No properties found for compound: ${args.name}`;
            
            SharedContext.appendAudit({ event: 'pubchem_search', name: args.name });
            return [
                `[PUBCHEM COMPOUND] ${args.name}`,
                `  CID:               ${prop.CID}`,
                `  IUPAC Name:        ${prop.IUPACName || 'N/A'}`,
                `  Formula:           ${prop.MolecularFormula || 'N/A'}`,
                `  Molecular Weight:  ${prop.MolecularWeight || 'N/A'} g/mol`,
                `  SMILES:            ${prop.CanonicalSMILES || 'N/A'}`
            ].join('\n');
        } catch (e: any) {
            return `[PUBCHEM SEARCH ERROR]: ${e.message}`;
        }
    }
}

// ---------------------------------------------------------------------------
// PubMed Search Tool
// ---------------------------------------------------------------------------
export class PubMedSearchTool extends Tool {
    name = 'pubmed_search';
    description = 'Search PubMed for medical/biological scientific literature.';
    schema = {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search term or query' },
            limit: { type: 'number', default: 5, description: 'Max results to return' }
        },
        required: ['query']
    };

    async execute(args: any): Promise<string> {
        const term = encodeURIComponent(args.query);
        const limit = args.limit || 5;
        const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${term}&retmax=${limit}&retmode=json`;
        try {
            const searchRes = await fetch(searchUrl);
            if (!searchRes.ok) throw new Error(`PubMed search failed with status ${searchRes.status}`);
            const searchData = await searchRes.json();
            const ids = searchData.esearchresult?.idlist || [];
            if (ids.length === 0) return `No PubMed articles found for query: ${args.query}`;

            const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
            const summaryRes = await fetch(summaryUrl);
            if (!summaryRes.ok) throw new Error(`PubMed summary failed with status ${summaryRes.status}`);
            const summaryData = await summaryRes.json();
            const results = summaryData.result || {};

            SharedContext.appendAudit({ event: 'pubmed_search', query: args.query });

            const lines = [`PubMed Search Results for: "${args.query}"`, ''];
            for (const id of ids) {
                const article = results[id];
                if (article) {
                    lines.push(`- [PMID ${id}] ${article.title}`);
                    lines.push(`  Authors:  ${(article.authors || []).map((a: any) => a.name).join(', ')}`);
                    lines.push(`  Journal:  ${article.source} (${article.pubdate})`);
                    lines.push('');
                }
            }
            return lines.join('\n');
        } catch (e: any) {
            return `[PUBMED SEARCH ERROR]: ${e.message}`;
        }
    }
}

// ---------------------------------------------------------------------------
// arXiv Search Tool
// ---------------------------------------------------------------------------
export class ArxivSearchTool extends Tool {
    name = 'arxiv_search';
    description = 'Search arXiv for computer science, mathematics, or physics papers.';
    schema = {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search term' },
            limit: { type: 'number', default: 5, description: 'Max results to return' }
        },
        required: ['query']
    };

    async execute(args: any): Promise<string> {
        const term = encodeURIComponent(args.query);
        const limit = args.limit || 5;
        const url = `http://export.arxiv.org/api/query?search_query=all:${term}&max_results=${limit}`;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`arXiv returned status ${res.status}`);
            const text = await res.text();
            
            // Basic regex parsing of the Atom XML feed
            SharedContext.appendAudit({ event: 'arxiv_search', query: args.query });
            const entries = text.split('<entry>');
            const lines = [`arXiv Search Results for: "${args.query}"`, ''];
            
            for (let i = 1; i < entries.length && i <= limit; i++) {
                const entry = entries[i];
                const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
                const idMatch = entry.match(/<id>([\s\S]*?)<\/id>/);
                const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);

                const title = titleMatch?.[1]?.trim().replace(/\s+/g, ' ') || 'Unknown Title';
                const id = idMatch?.[1]?.trim() || 'N/A';
                const summary = summaryMatch?.[1]?.trim().replace(/\s+/g, ' ').slice(0, 200) || '';

                lines.push(`- [${id}] ${title}`);
                if (summary) lines.push(`  Abstract: ${summary}...`);
                lines.push('');
            }
            return lines.join('\n');
        } catch (e: any) {
            return `[ARXIV SEARCH ERROR]: ${e.message}`;
        }
    }
}
