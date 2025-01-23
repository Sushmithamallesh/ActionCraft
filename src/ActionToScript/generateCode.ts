import { AutomationInput } from '../VideoToAction/TaskAnalysisDisplay.js';
import { announce } from '../utils.js';
import { CodeGeneratorAgent } from './CodeGeneratorAgent.js';
import { CodeFixerAgent } from './CodeFixerAgent.js';
import { CodeValidatorAgent } from './CodeValidatorAgent.js';

const AUTOMATION_FILE = './content/automation_input.json';

export async function generateAutomationCode(input: AutomationInput): Promise<string> {
    // call code generation agent
    const codeGeneratorAgent = CodeGeneratorAgent.getInstance();
    const codeValidatorAgent = CodeValidatorAgent.getInstance();
    const codeFixerAgent = CodeFixerAgent.getInstance();
    // read from input file
    const inputFilePath = AUTOMATION_FILE;
    await codeGeneratorAgent.generateCode(inputFilePath);

    let isValid = false

    while (!isValid) {
    // Validation Agent checks code
    const validationResult = await codeValidatorAgent.validateCode();
    
    if (validationResult.valid) {
        isValid = true
        break
    }

    // If not valid, Code Fixer Agent fixes issues
    const issues = validationResult.issues;
    const fixedCode = await codeFixerAgent.fixCode(issues);
    await codeGeneratorAgent.generateCode(inputFilePath);
    }
    
    return '';
}
