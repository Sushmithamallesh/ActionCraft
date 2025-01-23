import OpenAI from 'openai';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ChatCompletionContentPartImage, ChatCompletionContentPartText } from 'openai/resources/chat/completions';
import { config } from '../config.js';

// Custom error types for better error handling
class GridAnalysisError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'GridAnalysisError';
    }
}

// Enums for better type safety
enum AnalysisErrorCode {
    API_KEY_MISSING = 'API_KEY_MISSING',
    FOLDER_ACCESS_ERROR = 'FOLDER_ACCESS_ERROR',
    NO_IMAGES_FOUND = 'NO_IMAGES_FOUND',
    FILE_ACCESS_ERROR = 'FILE_ACCESS_ERROR',
    INVALID_RESPONSE_FORMAT = 'INVALID_RESPONSE_FORMAT',
    ANALYSIS_ERROR = 'ANALYSIS_ERROR',
    UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

interface UserView {
    taskType: string;
    summary: string;
    actionSequence: string[];
    possibleAutomations: string[];
}

interface Frame {
    url: string;
    mainAction: string;
    selectors: string[];
    waitConditions: string[];
    stateChanges: string[];
}

interface AutomationNotes {
    criticalElements: string[];
    errorScenarios: string[];
    dynamicContent: string[];
}

interface TechnicalDetails {
    frames: Frame[];
    automationNotes: AutomationNotes;
}

export interface AnalysisResult {
    userView: UserView;
    technicalDetails: TechnicalDetails;
    metadata: {
        analyzedAt: string;
        totalFrames: number;
    };
}

interface GridAnalyzerOptions {
    apiKey?: string;
    maxTokens?: number;
    temperature?: number;
    outputFormat?: 'json' | 'markdown';
    customPrompt?: string;
}

export class GridToAction {
    private readonly openai: OpenAI;
    private readonly gridFolder: string;
    private readonly outputFile: string;
    private readonly options: Required<GridAnalyzerOptions>;

    private static readonly DEFAULT_OPTIONS: Required<GridAnalyzerOptions> = {
        apiKey: '',
        maxTokens: 2000,
        temperature: 0,
        outputFormat: 'json',
        customPrompt: ''
    };

    constructor(options: GridAnalyzerOptions = {}) {
        this.options = { ...GridToAction.DEFAULT_OPTIONS, ...options };

        const apiKey = this.options.apiKey || config.openai.apiKey;
        if (!apiKey) {
            throw new GridAnalysisError(
                'OpenAI API key is required. Please provide it or set OPENAI_API_KEY environment variable.',
                AnalysisErrorCode.API_KEY_MISSING
            );
        }

        this.openai = new OpenAI({ apiKey });
        this.gridFolder = path.join(process.cwd(), 'content', 'grid');
        this.outputFile = path.join(process.cwd(), 'content', 'grid_analysis.json');
    }

    private async validateFolderAccess(): Promise<void> {
        try {
            await fs.access(this.gridFolder, fs.constants.R_OK);
        } catch (error) {
            throw new GridAnalysisError(
                'Cannot access grid folder. Check if it exists and has proper permissions.',
                AnalysisErrorCode.FOLDER_ACCESS_ERROR
            );
        }
    }

    private async getGridImages(): Promise<string[]> {
        try {
            const files = await fs.readdir(this.gridFolder);
            const imageFiles = files
                .filter(file => /\.(jpg|jpeg|png)$/i.test(file))
                .sort((a, b) => {
                    const numA = parseInt(a.match(/\d+/)?.[0] || '0');
                    const numB = parseInt(b.match(/\d+/)?.[0] || '0');
                    return numA - numB;
                });

            if (imageFiles.length === 0) {
                throw new GridAnalysisError(
                    'No image files found in the grid folder.',
                    AnalysisErrorCode.NO_IMAGES_FOUND
                );
            }

            return imageFiles.map(file => path.join(this.gridFolder, file));
        } catch (error) {
            if (error instanceof GridAnalysisError) throw error;
            throw new GridAnalysisError(
                'Error accessing grid images: ' + (error as Error).message,
                AnalysisErrorCode.FILE_ACCESS_ERROR
            );
        }
    }

    private getPrompt(): string {
        return `You are a Browser Automation Expert. Analyze these sequential frames and provide structured analysis for automation.

For each 2x2 grid of frames (ordered top-left to bottom-right), provide:

1. User-Friendly Summary:
   - Simple description of observed action
   - Main goal identified
   - Type of task (e.g., "Download Operation", "Data Entry", "Navigation")

2. Technical Details (for automation):
   - Page URL patterns
   - Exact button texts/selectors used
   - User inputs detected
   - Wait conditions needed
   - Download/upload operations
   - State changes

Output format (JSON):
{
  "userView": {
    "taskType": "Type of operation",
    "summary": "What user did in simple terms",
    "actionSequence": ["Step 1", "Step 2"...],
    "possibleAutomations": ["Option 1", "Option 2"...]
  },
  "technicalDetails": {
    "frames": [{
      "url": "URL pattern",
      "mainAction": "Primary action in frame",
      "selectors": ["Exact selectors found"],
      "waitConditions": ["Any waits needed"],
      "stateChanges": ["State changes to verify"]
    }],
    "automationNotes": {
      "criticalElements": ["Key elements to verify"],
      "errorScenarios": ["Possible failure points"],
      "dynamicContent": ["Elements that might change"]
    }
  }
}`;
    }

    private async analyzeImages(imagePaths: string[]): Promise<AnalysisResult> {
        try {
            const imageContents = await Promise.all(
                imagePaths.map(async (path) => ({
                    type: "image_url" as const,
                    image_url: {
                        url: `data:image/jpeg;base64,${(await fs.readFile(path)).toString('base64')}`
                    }
                }))
            );

            const response = await this.openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text" as const, text: this.getPrompt() },
                            ...imageContents
                        ],
                    }
                ],
                max_tokens: this.options.maxTokens,
                temperature: this.options.temperature,
            });

            const content = response.choices[0].message.content || '{}';
            const result = JSON.parse(content.replace(/^```json\n|\n```$/g, '').trim());

            if (!this.validateResponse(result)) {
                throw new GridAnalysisError(
                    'Invalid API response format',
                    AnalysisErrorCode.INVALID_RESPONSE_FORMAT
                );
            }

            result.metadata = {
                analyzedAt: new Date().toISOString(),
                totalFrames: imagePaths.length
            };

            return result;
        } catch (error) {
            console.error('Error analyzing images:', error);
            throw new GridAnalysisError(
                'Error analyzing images: ' + (error instanceof Error ? error.message : 'Unknown error'),
                AnalysisErrorCode.ANALYSIS_ERROR
            );
        }
    }

    private validateResponse(result: any): result is AnalysisResult {
        return result &&
               result.userView &&
               result.technicalDetails &&
               Array.isArray(result.userView.actionSequence) &&
               Array.isArray(result.userView.possibleAutomations) &&
               Array.isArray(result.technicalDetails.frames) &&
               result.technicalDetails.automationNotes &&
               Array.isArray(result.technicalDetails.automationNotes.criticalElements);
    }

    async process(): Promise<AnalysisResult> {
        try {
            await this.validateFolderAccess();
            const imagePaths = await this.getGridImages();

            console.log(`Found ${imagePaths.length} grid images to analyze...`);
            
            const results = await this.analyzeImages(imagePaths);

            // Save results based on output format
            if (this.options.outputFormat === 'json') {
                await fs.writeFile(this.outputFile, JSON.stringify(results, null, 2));
            } else {
                const markdownPath = this.outputFile.replace('.json', '.md');
                await fs.writeFile(markdownPath, this.convertToMarkdown(results));
            }

            console.log(`Analysis complete! Results saved to ${this.outputFile}`);
            return results;
        } catch (error) {
            if (error instanceof GridAnalysisError) {
                throw error;
            }
            throw new GridAnalysisError(
                'Unexpected error during analysis: ' + (error as Error).message,
                AnalysisErrorCode.UNKNOWN_ERROR
            );
        }
    }

    private convertToMarkdown(results: AnalysisResult): string {
        return `# UI Automation Analysis

## User View
- Task Type: ${results.userView.taskType}
- Summary: ${results.userView.summary}

### Action Sequence
${results.userView.actionSequence.map((step, i) => `${i + 1}. ${step}`).join('\n')}

### Possible Automations
${results.userView.possibleAutomations.map(option => `- ${option}`).join('\n')}

## Technical Details

### Frame Analysis
${results.technicalDetails.frames.map(frame => `
#### ${frame.mainAction}
- URL: ${frame.url}
- Selectors:
${frame.selectors.map(selector => `  - \`${selector}\``).join('\n')}
- Wait Conditions:
${frame.waitConditions.map(wait => `  - ${wait}`).join('\n')}
- State Changes:
${frame.stateChanges.map(state => `  - ${state}`).join('\n')}
`).join('\n')}

### Automation Notes
- Critical Elements:
${results.technicalDetails.automationNotes.criticalElements.map(elem => `  - ${elem}`).join('\n')}
- Error Scenarios:
${results.technicalDetails.automationNotes.errorScenarios.map(err => `  - ${err}`).join('\n')}
- Dynamic Content:
${results.technicalDetails.automationNotes.dynamicContent.map(content => `  - ${content}`).join('\n')}

## Metadata
- Analyzed At: ${results.metadata.analyzedAt}
- Total Frames: ${results.metadata.totalFrames}
`;
    }
}

// Example usage:
// const analyzer = new GridAnalyzer();
// analyzer.process().catch(console.error); 