import chalk from 'chalk';
import prompts from 'prompts';
import boxen from 'boxen';
import type { AnalysisResult } from './GridToAction.js';
import fs from 'fs/promises';

interface AutomationConfig {
    type: string;
    sequence: string[];
}

interface TaskInput {
    type: string;
    summary: string;
    sequence: string[];
    elements: string[];
    timestamp: string;
}

// Remove the savedFilePath variable since we'll use a constant
const AUTOMATION_FILE = 'content/automation_input.json';

export class TaskAnalysisDisplay {
    private taskInput: TaskInput;
    private result: AnalysisResult;

    constructor(result: AnalysisResult) {
        this.result = result;
        this.taskInput = {
            type: result.userView.taskType,
            summary: result.userView.summary,
            sequence: [...result.userView.actionSequence],
            elements: [...result.technicalDetails.automationNotes.criticalElements],
            timestamp: new Date().toISOString()
        };
    }

    async display(): Promise<AutomationConfig> {
        await this.handleTaskOverview();
        await this.handleSequence();
        await this.handleTechnicalElements();
        const automationType = await this.handleAutomationSelection();
        
        await this.saveTaskInput(automationType);

        const config: AutomationConfig = {
            type: automationType,
            sequence: this.taskInput.sequence
        };

        this.displayConfigSummary(config);
        return config;
    }

    private async handleTaskOverview(): Promise<void> {
        this.displayBox('Task Overview', [
            `Type: ${this.taskInput.type}`,
            `Summary: ${this.taskInput.summary}`
        ]);

        if (!(await this.confirmOrModify('Is this task analysis correct?'))) {
            const { type, summary } = await prompts([
                { type: 'text', name: 'type', message: 'Enter task type:', initial: this.taskInput.type },
                { type: 'text', name: 'summary', message: 'Enter summary:', initial: this.taskInput.summary }
            ]);
            this.taskInput.type = type;
            this.taskInput.summary = summary;
        }
    }

    private async handleSequence(): Promise<void> {
        this.displaySection('Action Sequence', this.taskInput.sequence);
        if (await this.confirmOrModify('Would you like to modify the sequence?')) {
            this.taskInput.sequence = await this.editItems(this.taskInput.sequence, 'step');
        }
    }

    private async handleTechnicalElements(): Promise<void> {
        this.displaySection('Technical Elements', this.taskInput.elements);
        if (await this.confirmOrModify('Would you like to modify the elements?')) {
            this.taskInput.elements = await this.editItems(this.taskInput.elements, 'element');
        }
    }

    private async handleAutomationSelection(): Promise<string> {
        this.displaySection('Available Automations', this.result.userView.possibleAutomations);
        return this.selectAutomationType(this.result.userView.possibleAutomations);
    }

    private displayBox(title: string, content: string[]): void {
        console.log(boxen(
            chalk.bold.blue(`🤖 ${title}`) + '\n' +
            content.map(line => chalk.white(line)).join('\n'),
            { padding: 1, margin: 1, borderStyle: 'round' }
        ));
    }

    private displaySection(title: string, items: string[]): void {
        console.log(chalk.yellow(`\n📋 ${title}:`));
        items.forEach((item, i) => console.log(`  ${chalk.green(i + 1)}. ${item}`));
    }

    private async confirmOrModify(message: string): Promise<boolean> {
        const { confirm } = await prompts({
            type: 'confirm',
            name: 'confirm',
            message,
            initial: true
        });
        return confirm;
    }

    private async editItems(items: string[], itemType: string): Promise<string[]> {
        const currentItems = [...items];
        
        while (true) {
            this.displaySection(`Current ${itemType}s`, currentItems);
            const { action } = await prompts({
                type: 'select',
                name: 'action',
                message: 'Choose action:',
                choices: [
                    { title: '➕ Add', value: 'add' },
                    { title: '✏️  Edit', value: 'edit' },
                    { title: '🗑️  Remove', value: 'remove' },
                    { title: '✅ Done', value: 'done' }
                ]
            });

            if (action === 'done') break;

            switch (action) {
                case 'add': {
                    const { text } = await prompts({
                        type: 'text',
                        name: 'text',
                        message: `Enter new ${itemType}:`
                    });
                    if (text) currentItems.push(text);
                    break;
                }
                case 'edit':
                case 'remove': {
                    const { index } = await prompts({
                        type: 'select',
                        name: 'index',
                        message: `Select ${itemType} to ${action}:`,
                        choices: currentItems.map((item, i) => ({
                            title: `${i + 1}. ${item}`,
                            value: i
                        }))
                    });

                    if (typeof index === 'number') {
                        if (action === 'remove') {
                            currentItems.splice(index, 1);
                        } else {
                            const { text } = await prompts({
                                type: 'text',
                                name: 'text',
                                message: 'Enter new text:',
                                initial: currentItems[index]
                            });
                            if (text) currentItems[index] = text;
                        }
                    }
                    break;
                }
            }
        }

        return currentItems;
    }

    private async selectAutomationType(possibleTypes: string[]): Promise<string> {
        const { choice } = await prompts({
            type: 'select',
            name: 'choice',
            message: 'Select automation type:',
            choices: [
                ...possibleTypes.map(type => ({ title: type, value: type })),
                { title: '✨ Custom', value: 'custom' }
            ]
        });

        if (choice === 'custom') {
            const { customType } = await prompts({
                type: 'text',
                name: 'customType',
                message: 'Enter custom automation type:',
                validate: input => input.length > 0 || 'Please provide a type'
            });
            return customType;
        }

        return choice;
    }

    private async saveTaskInput(selectedType: string): Promise<void> {
        try {
            const automationInput = {
                originalAnalysis: {
                    technicalDetails: this.result.technicalDetails,
                    possibleAutomations: this.result.userView.possibleAutomations,
                    sequence: this.result.userView.actionSequence
                },
                userEdits: {
                    type: this.taskInput.type,
                    summary: this.taskInput.summary,
                    sequence: this.taskInput.sequence,
                    elements: this.taskInput.elements
                },
                automation: {
                    selectedAutomationType: selectedType
                }
            };

            await fs.writeFile(AUTOMATION_FILE, JSON.stringify(automationInput, null, 2));
        } catch (error) {
            console.error(chalk.red('\n❌ Failed to save task input:', error));
        }
    }

    private displayConfigSummary(config: AutomationConfig): void {
        const summary = [
            `Type: ${config.type}`,
            'Sequence:',
            ...config.sequence.map((step, i) => `  ${i + 1}. ${step}`),
            '',
            chalk.dim('───────────────────────'),
            '',
            chalk.yellow('💾 Task details have been saved to:'),
            chalk.blue(AUTOMATION_FILE),
            chalk.dim('You can edit this file directly to make further changes.')
        ];

        this.displayBox('Automation Configuration', summary);
    }
}

// Example usage:
/*
import { GridAnalyzer } from './GridToAction.js';

async function main() {
    const analyzer = new GridAnalyzer();
    const analysis = await analyzer.process();
    const display = new TaskAnalysisDisplay(analysis);
    const config = await display.display();
    // Use config for automation...
}

main().catch(console.error);
*/