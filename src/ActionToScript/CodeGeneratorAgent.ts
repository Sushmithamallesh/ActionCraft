import * as fs from 'fs';
import * as path from 'path';

export class CodeGeneratorAgent {
    private static instance: CodeGeneratorAgent;

    private systemPrompt = ``;

    private userPromptTemplate = ``;

    private constructor() {}

    public static getInstance(): CodeGeneratorAgent {
        if (!CodeGeneratorAgent.instance) {
            CodeGeneratorAgent.instance = new CodeGeneratorAgent();
        }
        return CodeGeneratorAgent.instance;
    }

    public async generateCode(inputFilePath: string): Promise<string> {
        return "";
    }
}