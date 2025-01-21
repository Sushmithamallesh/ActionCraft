import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getVideoDurationInSeconds } from 'get-video-duration';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execAsync = promisify(exec);

// Custom error types for better error handling
class VideoProcessingError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'VideoProcessingError';
    }
}

interface FrameConfig {
    interval: number;
    maxFrames: number;
}

interface GridDimensions {
    width: number;
    height: number;
}

export class VideoFrameExtractor {
    private readonly sourceFolder = path.join(process.cwd(), 'content', 'automate');
    private readonly framesFolder = path.join(process.cwd(), 'content', 'frames');
    private readonly gridFolder = path.join(process.cwd(), 'content', 'grid');
    private readonly supportedFormats = ['.mp4', '.mov', '.avi', '.mkv', '.wmv'];
    private readonly gridSize: GridDimensions = {
        width: 1920,  // 960x540 per frame in 2x2 grid
        height: 1080
    };

    private async validateFFmpeg(): Promise<void> {
        try {
            await execAsync('ffmpeg -version');
        } catch (error) {
            throw new VideoProcessingError(
                'FFmpeg is not installed or not in PATH. Please install FFmpeg first.',
                'FFMPEG_NOT_FOUND'
            );
        }
    }

    private async validateFolderPermissions(): Promise<void> {
        try {
            // Check read access to source folder
            await fs.access(this.sourceFolder, fs.constants.R_OK);
            
            // Check write access to output folder
            try {
                await fs.access(this.framesFolder);
                await fs.access(this.framesFolder, fs.constants.W_OK);
            } catch {
                await fs.mkdir(this.framesFolder, { recursive: true });
            }
        } catch (error) {
            throw new VideoProcessingError(
                'Insufficient permissions to access folders. Check folder permissions.',
                'PERMISSION_ERROR'
            );
        }
    }

    private async findVideo(): Promise<{ path: string }> {
        try {
            const files = await fs.readdir(this.sourceFolder);
            
            const videoFiles = files.filter(file => {
                const ext = path.extname(file).toLowerCase();
                return this.supportedFormats.includes(ext);
            });

            if (videoFiles.length === 0) {
                throw new VideoProcessingError(
                    `No video file found. Supported formats: ${this.supportedFormats.join(', ')}`,
                    'NO_VIDEO_FOUND'
                );
            }
            if (videoFiles.length > 1) {
                throw new VideoProcessingError(
                    'Multiple video files found. Please keep only one video file',
                    'MULTIPLE_VIDEOS'
                );
            }

            const videoPath = path.join(this.sourceFolder, videoFiles[0]);
            
            // Check if file is readable and not empty
            const stats = await fs.stat(videoPath);
            if (stats.size === 0) {
                throw new VideoProcessingError('Video file is empty', 'EMPTY_FILE');
            }

            return { path: videoPath };
        } catch (error) {
            if (error instanceof VideoProcessingError) throw error;
            throw new VideoProcessingError(
                'Error accessing video file: ' + (error as Error).message,
                'FILE_ACCESS_ERROR'
            );
        }
    }

    private async validateDuration(videoPath: string): Promise<number> {
        try {
            const durationInSeconds = await getVideoDurationInSeconds(videoPath);
            
            if (isNaN(durationInSeconds) || durationInSeconds <= 0) {
                throw new VideoProcessingError(
                    'Invalid video duration detected',
                    'INVALID_DURATION'
                );
            }

            const durationInMinutes = durationInSeconds / 60;
            if (durationInMinutes > 5) {
                throw new VideoProcessingError(
                    'Video length exceeds 5 minutes limit',
                    'DURATION_TOO_LONG'
                );
            }

            return durationInSeconds;
        } catch (error) {
            if (error instanceof VideoProcessingError) throw error;
            throw new VideoProcessingError(
                'Error reading video duration: ' + (error as Error).message,
                'DURATION_READ_ERROR'
            );
        }
    }

    private getFrameConfig(durationInMinutes: number): FrameConfig {
        if (durationInMinutes <= 0.5) {
            return { interval: 2, maxFrames: 16 };     // Every 2s, 4 grids for 30s video
        } else if (durationInMinutes <= 1) {
            return { interval: 3, maxFrames: 20 };     // Every 3s, 5 grids for 1m video
        } else if (durationInMinutes <= 2) {
            return { interval: 4, maxFrames: 28 };     // Every 4s, 7 grids for 2m video
        } else if (durationInMinutes <= 3) {
            return { interval: 5, maxFrames: 32 };     // Every 5s, 8 grids for 3m video
        } else if (durationInMinutes <= 4) {
            return { interval: 6, maxFrames: 36 };     // Every 6s, 9 grids for 4m video
        } else {
            return { interval: 7, maxFrames: 40 };     // Every 7s, 10 grids for 5m video
        }
    }

    private async prepareOutputFolder(): Promise<void> {
        try {
            await fs.access(this.framesFolder);
        } catch {
            await fs.mkdir(this.framesFolder, { recursive: true });
        }
        
        // Clean existing frames
        const files = await fs.readdir(this.framesFolder);
        await Promise.all(
            files.map(file => fs.unlink(path.join(this.framesFolder, file)))
        );
    }

    private async extractFrame(videoPath: string, timeInSeconds: number, outputPath: string): Promise<void> {
        // Improved ffmpeg command with better quality settings
        const command = `ffmpeg -ss ${timeInSeconds} -i "${videoPath}" -vframes 1 -q:v 1 -pix_fmt rgb24 "${outputPath}"`;
        await execAsync(command);
    }

    private async createGrid(frameFiles: string[], gridIndex: number): Promise<void> {
        if (frameFiles.length === 0) return;
        
        const composite = sharp({
            create: {
                width: this.gridSize.width,
                height: this.gridSize.height,
                channels: 3,
                background: { r: 0, g: 0, b: 0 }
            }
        });

        const frameWidth = Math.floor(this.gridSize.width / 2);
        const frameHeight = Math.floor(this.gridSize.height / 2);
        const gap = 2;

        // Prepare frame overlays with improved quality
        const overlays = await Promise.all(
            frameFiles.slice(0, 4).map(async (framePath, index) => {
                const frame = await sharp(framePath)
                    .resize(frameWidth - gap, frameHeight - gap, {
                        fit: 'fill',
                        background: { r: 0, g: 0, b: 0 },
                        kernel: 'lanczos3',    // Higher quality resampling
                        withoutEnlargement: true  // Prevent quality loss from upscaling
                    })
                    .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })  // Highest JPEG quality
                    .toBuffer();

                return {
                    input: frame,
                    top: Math.floor(index / 2) * frameHeight + Math.floor(gap / 2),
                    left: (index % 2) * frameWidth + Math.floor(gap / 2),
                };
            })
        );

        // Create the grid with highest quality settings
        await composite
            .composite(overlays)
            .jpeg({ 
                quality: 100, 
                chromaSubsampling: '4:4:4'  // No chroma subsampling
            })
            .toFile(path.join(this.gridFolder, `grid_${String(gridIndex).padStart(3, '0')}.jpg`));
    }

    private async createGrids(frameFiles: string[]): Promise<void> {
        // Prepare grid folder
        try {
            await fs.access(this.gridFolder);
        } catch {
            await fs.mkdir(this.gridFolder, { recursive: true });
        }

        // Clean existing grids
        const existingGrids = await fs.readdir(this.gridFolder);
        await Promise.all(
            existingGrids.map(file => fs.unlink(path.join(this.gridFolder, file)))
        );

        // Create grids in batches of 4 frames
        const numGrids = Math.ceil(frameFiles.length / 4);
        await Promise.all(
            Array.from({ length: numGrids }, async (_, i) => {
                const gridFrames = frameFiles.slice(i * 4, (i + 1) * 4);
                await this.createGrid(gridFrames, i);
            })
        );

        console.log(`Created ${numGrids} grid${numGrids === 1 ? '' : 's'}`);
    }

    private async extractFrames(videoPath: string, durationInSeconds: number): Promise<string[]> {
        await this.prepareOutputFolder();

        const config = this.getFrameConfig(durationInSeconds / 60);
        const frameCount = Math.min(
            Math.floor(durationInSeconds / config.interval) + 1,
            config.maxFrames
        );

        const frameFiles: string[] = [];

        // Extract first frame
        const firstFramePath = path.join(this.framesFolder, 'frame_000.jpg');
        await this.extractFrame(videoPath, 0, firstFramePath);
        frameFiles.push(firstFramePath);

        // Extract middle frames
        const interval = (durationInSeconds - 1) / (frameCount - 2);
        await Promise.all(
            Array.from({ length: frameCount - 2 }, async (_, i) => {
                const timeInSeconds = (i + 1) * interval;
                const frameNumber = String(i + 1).padStart(3, '0');
                const framePath = path.join(this.framesFolder, `frame_${frameNumber}.jpg`);
                await this.extractFrame(videoPath, timeInSeconds, framePath);
                frameFiles.push(framePath);
            })
        );

        // Extract last frame
        const lastFrameNumber = String(frameCount - 1).padStart(3, '0');
        const lastFramePath = path.join(this.framesFolder, `frame_${lastFrameNumber}.jpg`);
        await this.extractFrame(videoPath, durationInSeconds - 0.1, lastFramePath);
        frameFiles.push(lastFramePath);

        console.log(`Extracted ${frameCount} frames`);
        return frameFiles.sort();  // Ensure frames are in order
    }

    async process(): Promise<void> {
        try {
            await this.validateFFmpeg();
            await this.validateFolderPermissions();

            const video = await this.findVideo();
            const duration = await this.validateDuration(video.path);
            const frameFiles = await this.extractFrames(video.path, duration);
            await this.createGrids(frameFiles);
            this.logDurationCategory(duration / 60);
        } catch (error) {
            if (error instanceof VideoProcessingError) {
                throw error;
            }
            throw new VideoProcessingError(
                'Unexpected error during video processing: ' + (error as Error).message,
                'UNKNOWN_ERROR'
            );
        }
    }

    private logDurationCategory(durationInMinutes: number): void {
        if (durationInMinutes < 1) {
            console.log('Video is less than 1 minute');
        } else if (durationInMinutes <= 3) {
            console.log('Video is between 1 and 3 minutes');
        } else {
            console.log('Video is between 3 and 5 minutes');
        }
    }
}
