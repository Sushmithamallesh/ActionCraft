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

export async function displayAnalysis(result: AnalysisResult): Promise<AutomationConfig> {
    // Initialize task input
    const taskInput: TaskInput = {
        type: result.userView.taskType,
        summary: result.userView.summary,
        sequence: [...result.userView.actionSequence],
        elements: [...result.technicalDetails.automationNotes.criticalElements],
        timestamp: new Date().toISOString()
    };

    // Display and validate task overview
    displayBox('Task Overview', [
        `Type: ${taskInput.type}`,
        `Summary: ${taskInput.summary}`
    ]);

    if (!(await confirmOrModify('Is this task analysis correct?'))) {
        const { type, summary } = await prompts([
            { type: 'text', name: 'type', message: 'Enter task type:', initial: taskInput.type },
            { type: 'text', name: 'summary', message: 'Enter summary:', initial: taskInput.summary }
        ]);
        taskInput.type = type;
        taskInput.summary = summary;
    }

    // Handle sequence
    displaySection('Action Sequence', taskInput.sequence);
    if (await confirmOrModify('Would you like to modify the sequence?')) {
        taskInput.sequence = await editItems(taskInput.sequence, 'step');
    }

    // Handle technical elements
    displaySection('Technical Elements', taskInput.elements);
    if (await confirmOrModify('Would you like to modify the elements?')) {
        taskInput.elements = await editItems(taskInput.elements, 'element');
    }

    // Handle automation selection
    displaySection('Available Automations', result.userView.possibleAutomations);
    const automationType = await selectAutomationType(result.userView.possibleAutomations);
    
    // Save task input
    await saveTaskInput(taskInput);

    const config: AutomationConfig = {
        type: automationType,
        sequence: taskInput.sequence
    };

    displayConfigSummary(config);
    return config;
}

// Display Helpers
function displayBox(title: string, content: string[]): void {
    console.log(boxen(
        chalk.bold.blue(`🤖 ${title}`) + '\n' +
        content.map(line => chalk.white(line)).join('\n'),
        { padding: 1, margin: 1, borderStyle: 'round' }
    ));
}

function displaySection(title: string, items: string[]): void {
    console.log(chalk.yellow(`\n📋 ${title}:`));
    items.forEach((item, i) => console.log(`  ${chalk.green(i + 1)}. ${item}`));
}

// Input Helpers
async function confirmOrModify(message: string): Promise<boolean> {
    const { confirm } = await prompts({
        type: 'confirm',
        name: 'confirm',
        message,
        initial: true
    });
    return confirm;
}

async function editItems(items: string[], itemType: string): Promise<string[]> {
    const currentItems = [...items];
    
    while (true) {
        displaySection(`Current ${itemType}s`, currentItems);
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

async function selectAutomationType(possibleTypes: string[]): Promise<string> {
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

async function saveTaskInput(input: TaskInput): Promise<void> {
    try {
        await fs.writeFile(AUTOMATION_FILE, JSON.stringify(input, null, 2));
    } catch (error) {
        console.error(chalk.red('\n❌ Failed to save task input:', error));
    }
}

function displayConfigSummary(config: AutomationConfig): void {
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

    displayBox('Automation Configuration', summary);
}

// Example usage:
/*
import { GridAnalyzer } from './GridToAction.js';

async function main() {
    const analyzer = new GridAnalyzer();
    const analysis = await analyzer.process();
    const config = await displayAnalysis(analysis);
    // Use config for automation...
}

main().catch(console.error);
*/