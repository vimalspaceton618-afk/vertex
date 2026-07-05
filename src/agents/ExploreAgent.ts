import { BaseAgent } from '../core/agent/BaseAgent.js';
import { ReadFileTool, ListDirTool } from '../tools/FileSystem.js';
import { AnalyzeImageTool } from '../tools/Vision.js';
import { CodeSearchTool } from '../tools/CodeSearch.js';
import { GitStatusTool, GitDiffTool, GitLogTool, GitBranchTool } from '../tools/Git.js';
import { NcbiFetchTool, UniProtFetchTool, PubChemSearchTool, PubMedSearchTool, ArxivSearchTool } from '../tools/ScienceSkills.js';

export class ExploreAgent extends BaseAgent {
    constructor() {
        super(
            "ExploreAgent",
            "You are the Explore Agent. Your goal is to navigate the codebase, read files, query scientific databases, and gather context. You cannot write files or execute commands."
        );
    }

    protected setupTools(): void {
        this.registry.register(new ReadFileTool());
        this.registry.register(new ListDirTool());
        this.registry.register(new AnalyzeImageTool());
        this.registry.register(new CodeSearchTool());
        this.registry.register(new GitStatusTool());
        this.registry.register(new GitDiffTool());
        this.registry.register(new GitLogTool());
        this.registry.register(new GitBranchTool());
        // Science skills integration
        this.registry.register(new NcbiFetchTool());
        this.registry.register(new UniProtFetchTool());
        this.registry.register(new PubChemSearchTool());
        this.registry.register(new PubMedSearchTool());
        this.registry.register(new ArxivSearchTool());
    }
}
