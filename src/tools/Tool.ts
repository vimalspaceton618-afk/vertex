export abstract class Tool {
    abstract name: string;
    abstract description: string;
    abstract schema: Record<string, any>;

    /**
     * Executes the tool. 
     * @param args The JSON parsed arguments from the LLM
     * @param requestConfirmation A callback that the tool can invoke to pause and ask the user for Y/N approval
     */
    abstract execute(args: any, requestConfirmation: (promptMessage: string) => Promise<boolean>, signal?: AbortSignal): Promise<string> | AsyncGenerator<string, string, unknown>;
}
