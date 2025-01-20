import { VideoFrameExtractor } from './VideoMaker.js';

async function extractVideoFrames() {
    const extractor = new VideoFrameExtractor();
    
    console.log('Starting frame extraction...');
    
    try {
        await extractor.process();
        console.log('✅ Frame extraction completed successfully');
    } catch (error: any) {
        if (error.code) {
            console.error(`❌ Error [${error.code}]:`, error.message);
        } else {
            console.error('❌ Error:', error.message);
        }
        process.exit(1);
    }
}

extractVideoFrames(); 