import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Validate required environment variables
if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required in .env file');
}

export const config = {
    openai: {
        apiKey: process.env.OPENAI_API_KEY
    }
} as const; 