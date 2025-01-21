import { VideoFrameExtractor } from './VideoToGrid.js';
import { GridAnalyzer } from './GridToAction.js';
import { displayAnalysis } from './displayAnalysis.js';

async function extractVideoFrames() {
    const extractor = new VideoFrameExtractor();
    const analyzer = new GridAnalyzer();
    console.log('Starting frame extraction...');
    
    try {
        await extractor.process();
        console.log('✅ Frame extraction completed successfully');
        
        const analysis = await analyzer.process();
        console.log('✅ Grid analysis completed successfully');
        
        const config = await displayAnalysis(analysis);
        console.log('✨ Selected automation configuration:', config);
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