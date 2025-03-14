const { useState, useEffect, useRef, useSyncExternalStore, useCallback } = React;
const { createRoot } = ReactDOM;

// Initialize WebsimSocket
const room = new WebsimSocket();

const App = () => {
    const [activeTab, setActiveTab] = useState('draw');
    const canvasRef = useRef(null);
    const ctxRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState('#000000');
    const [brushSize, setBrushSize] = useState(5);
    const [tool, setTool] = useState('brush');
    const [uploadedImage, setUploadedImage] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [aiImage, setAiImage] = useState(null);
    
    // Get scores
    const updateScores = () => {
        let humanScore = 0;
        let aiScore = 0;
        
        challenges.forEach(challenge => {
            if (challenge.votes) {
                humanScore += challenge.votes.filter(v => v.choice === 'human').length;
                aiScore += challenge.votes.filter(v => v.choice === 'ai').length;
            }
        });
        
        return { humanScore, aiScore };
    };

    // Get challenges from database
    const challenges = useSyncExternalStore(
        room.collection('drawing_challenge').subscribe,
        room.collection('drawing_challenge').getList
    );
    
    const { humanScore, aiScore } = updateScores();

    // Initialize canvas
    useEffect(() => {
        if (activeTab === 'draw') {
            const canvas = canvasRef.current;
            if (canvas) {
                // Make canvas responsive
                canvas.width = canvas.offsetWidth;
                canvas.height = canvas.offsetWidth * 0.75; // 4:3 ratio
                
                const ctx = canvas.getContext('2d');
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.strokeStyle = color;
                ctx.lineWidth = brushSize;
                ctxRef.current = ctx;
                
                // Fill with white background
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
        }
    }, [activeTab]);

    // Handle Canvas Drawing
    const startDrawing = (e) => {
        if (tool === 'brush' || tool === 'eraser') {
            const { offsetX, offsetY } = getCoordinates(e);
            ctxRef.current.beginPath();
            ctxRef.current.moveTo(offsetX, offsetY);
            setIsDrawing(true);
        }
    };

    const draw = (e) => {
        if (!isDrawing) return;
        
        const { offsetX, offsetY } = getCoordinates(e);
        
        if (tool === 'brush') {
            ctxRef.current.strokeStyle = color;
            ctxRef.current.lineTo(offsetX, offsetY);
            ctxRef.current.stroke();
        } else if (tool === 'eraser') {
            ctxRef.current.strokeStyle = 'white';
            ctxRef.current.lineTo(offsetX, offsetY);
            ctxRef.current.stroke();
        }
    };

    const stopDrawing = () => {
        if (isDrawing) {
            ctxRef.current.closePath();
            setIsDrawing(false);
        }
    };
    
    // Get coordinates for both mouse and touch events
    const getCoordinates = (e) => {
        if (e.nativeEvent.offsetX !== undefined) {
            return { offsetX: e.nativeEvent.offsetX, offsetY: e.nativeEvent.offsetY };
        } else {
            const rect = canvasRef.current.getBoundingClientRect();
            return { 
                offsetX: e.touches[0].clientX - rect.left, 
                offsetY: e.touches[0].clientY - rect.top
            };
        }
    };

    // Handle image upload
    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const url = await websim.upload(file);
                setUploadedImage(url);
                
                // Draw the uploaded image on canvas
                const img = new Image();
                img.onload = () => {
                    const canvas = canvasRef.current;
                    const ctx = canvas.getContext('2d');
                    
                    // Clear canvas
                    ctx.fillStyle = 'white';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    
                    // Calculate dimensions to maintain aspect ratio and fit canvas
                    let width = img.width;
                    let height = img.height;
                    const maxWidth = canvas.width;
                    const maxHeight = canvas.height;
                    
                    if (width > maxWidth || height > maxHeight) {
                        const ratio = Math.min(maxWidth / width, maxHeight / height);
                        width *= ratio;
                        height *= ratio;
                    }
                    
                    const x = (canvas.width - width) / 2;
                    const y = (canvas.height - height) / 2;
                    
                    ctx.drawImage(img, x, y, width, height);
                };
                img.src = url;
            } catch (error) {
                console.error('Error uploading image:', error);
                alert('Failed to upload image. Please try again.');
            }
        }
    };
    
    // Clear canvas
    const clearCanvas = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        setUploadedImage(null);
    };
    
    // Submit drawing to AI
    const submitDrawing = async () => {
        setShowModal(true);
        setAiGenerating(true);
        
        try {
            // Get canvas data URL
            const canvas = canvasRef.current;
            const dataUrl = canvas.toDataURL('image/png');
            
            // Upload human drawing
            const humanImageUrl = await websim.upload(dataURLtoBlob(dataUrl));
            
            // Generate AI image based on the drawing
            const aiAnalysis = await websim.chat.completions.create({
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Describe this image in detail for AI image generation. Focus on the subject, style, colors, and composition. Make your description rich and detailed enough to create a similar but improved version."
                            },
                            {
                                type: "image_url",
                                image_url: { url: dataUrl }
                            }
                        ]
                    }
                ]
            });
            
            // Generate improved AI image based on the analysis
            const aiResult = await websim.imageGen({
                prompt: `Create an enhanced, detailed version of this drawing: ${aiAnalysis.content}`,
                aspect_ratio: "4:3"
            });
            
            setAiImage(aiResult.url);
            
            // Save the challenge to the database
            await room.collection('drawing_challenge').create({
                humanImage: humanImageUrl,
                aiImage: aiResult.url,
                aiPrompt: aiAnalysis.content,
                votes: [],
                randomOrder: Math.random() < 0.5 // Randomize order for voting
            });
            
        } catch (error) {
            console.error('Error submitting drawing:', error);
            alert('An error occurred while processing your submission. Please try again.');
        } finally {
            setAiGenerating(false);
        }
    };
    
    // Convert Data URL to Blob
    const dataURLtoBlob = (dataURL) => {
        const arr = dataURL.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        
        return new Blob([u8arr], { type: mime });
    };
    
    // Vote for an image
    const voteForImage = async (challengeId, choice) => {
        const challenge = challenges.find(c => c.id === challengeId);
        if (!challenge) return;
        
        // Check if user already voted
        const clientId = room.party.client.id;
        if (challenge.votes && challenge.votes.some(v => v.voterId === clientId)) {
            alert('You have already voted on this challenge!');
            return;
        }
        
        // Add vote
        const updatedVotes = [...(challenge.votes || []), {
            voterId: clientId,
            voterName: room.party.client.username,
            choice,
            timestamp: new Date().toISOString()
        }];
        
        // Update challenge with new vote
        await room.collection('drawing_challenge').update(challengeId, {
            votes: updatedVotes
        });
    };

    return (
        <div className="app-container">
            <header>
                <h1>AI vs Human: Drawing Challenge</h1>
                <div className="score-container">
                    <div className="score">
                        <div>Human Score</div>
                        <div className="score-value">{humanScore}</div>
                    </div>
                    <div className="score">
                        <div>AI Score</div>
                        <div className="score-value">{aiScore}</div>
                    </div>
                </div>
            </header>
            
            <div className="tab-container">
                <button 
                    className={`tab ${activeTab === 'draw' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('draw')}
                >
                    Draw & Challenge
                </button>
                <button 
                    className={`tab ${activeTab === 'gallery' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('gallery')}
                >
                    Vote Gallery
                </button>
            </div>
            
            <div className="content-container">
                {activeTab === 'draw' && (
                    <div className="draw-container">
                        <div className="upload-section">
                            <p>Upload an image or draw from scratch</p>
                            <input 
                                type="file" 
                                accept="image/*" 
                                onChange={handleImageUpload} 
                            />
                        </div>
                        
                        <div className="tools-container">
                            <div className="tool-group">
                                <button 
                                    className={`secondary-btn ${tool === 'brush' ? 'active' : ''}`}
                                    onClick={() => setTool('brush')}
                                >
                                    Brush
                                </button>
                                <button 
                                    className={`secondary-btn ${tool === 'eraser' ? 'active' : ''}`}
                                    onClick={() => setTool('eraser')}
                                >
                                    Eraser
                                </button>
                            </div>
                            
                            <div className="separator"></div>
                            
                            <div className="tool-group">
                                <label>Color: </label>
                                <input 
                                    type="color" 
                                    value={color}
                                    onChange={e => setColor(e.target.value)}
                                    className="color-picker"
                                />
                            </div>
                            
                            <div className="separator"></div>
                            
                            <div className="tool-group">
                                <label>Size: </label>
                                <input 
                                    type="range" 
                                    min="1" 
                                    max="50" 
                                    value={brushSize}
                                    onChange={e => setBrushSize(parseInt(e.target.value))}
                                />
                                <span>{brushSize}px</span>
                            </div>
                            
                            <div className="separator"></div>
                            
                            <button 
                                className="secondary-btn"
                                onClick={clearCanvas}
                            >
                                Clear
                            </button>
                        </div>
                        
                        <div className="canvas-container">
                            <canvas
                                ref={canvasRef}
                                id="drawingCanvas"
                                onMouseDown={startDrawing}
                                onMouseMove={draw}
                                onMouseUp={stopDrawing}
                                onMouseLeave={stopDrawing}
                                onTouchStart={startDrawing}
                                onTouchMove={draw}
                                onTouchEnd={stopDrawing}
                            />
                        </div>
                        
                        <div className="footer-container">
                            <div></div>
                            <button 
                                className="primary-btn"
                                onClick={submitDrawing}
                            >
                                Challenge the AI
                            </button>
                        </div>
                    </div>
                )}
                
                {activeTab === 'gallery' && (
                    <div className="gallery-container">
                        {challenges.length === 0 ? (
                            <div className="loading">No challenges yet. Create the first one!</div>
                        ) : (
                            challenges.map(challenge => (
                                <div key={challenge.id} className="gallery-item">
                                    <div className="gallery-images">
                                        <img 
                                            src={challenge.randomOrder ? challenge.aiImage : challenge.humanImage} 
                                            alt="Drawing 1" 
                                            className="gallery-image"
                                        />
                                        <img 
                                            src={challenge.randomOrder ? challenge.humanImage : challenge.aiImage} 
                                            alt="Drawing 2" 
                                            className="gallery-image"
                                        />
                                    </div>
                                    <div className="gallery-info">
                                        <p>Which drawing looks better?</p>
                                        <div className="vote-buttons">
                                            <button 
                                                className="primary-btn"
                                                onClick={() => voteForImage(challenge.id, challenge.randomOrder ? 'ai' : 'human')}
                                                disabled={challenge.votes && challenge.votes.some(v => v.voterId === room.party.client.id)}
                                            >
                                                Left Drawing
                                            </button>
                                            <button 
                                                className="primary-btn"
                                                onClick={() => voteForImage(challenge.id, challenge.randomOrder ? 'human' : 'ai')}
                                                disabled={challenge.votes && challenge.votes.some(v => v.voterId === room.party.client.id)}
                                            >
                                                Right Drawing
                                            </button>
                                        </div>
                                        <p style={{marginTop: "10px"}}>
                                            {challenge.votes ? `${challenge.votes.length} votes` : "0 votes"}
                                        </p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
            
            {showModal && (
                <div className="modal-backdrop" onClick={e => {
                    if (e.target.className === 'modal-backdrop') {
                        setShowModal(false);
                    }
                }}>
                    <div className="modal-content">
                        <h2 className="modal-title">AI Challenge Result</h2>
                        
                        {aiGenerating ? (
                            <div className="ai-processing">
                                <p>AI is analyzing your drawing and creating an improved version...</p>
                                <div style={{margin: "20px 0"}}>
                                    <svg width="40" height="40" viewBox="0 0 50 50">
                                        <circle cx="25" cy="25" r="20" fill="none" stroke="#4a00e0" strokeWidth="5" strokeDasharray="31.4 31.4">
                                            <animateTransform 
                                                attributeName="transform" 
                                                attributeType="XML" 
                                                type="rotate"
                                                from="0 25 25"
                                                to="360 25 25"
                                                dur="1s"
                                                repeatCount="indefinite"
                                            />
                                        </circle>
                                    </svg>
                                </div>
                            </div>
                        ) : (
                            <>
                                <p>Your drawing has been processed! Check out how the AI tried to improve it.</p>
                                <div className="comparison-container">
                                    <div className="comparison-image">
                                        <div className="comparison-title">Your Drawing</div>
                                        <img src={canvasRef.current.toDataURL()} alt="Your Drawing" />
                                    </div>
                                    <div className="comparison-image">
                                        <div className="comparison-title">AI's Version</div>
                                        <img src={aiImage} alt="AI Generated Drawing" />
                                    </div>
                                </div>
                                <p>Your challenge has been added to the gallery for voting!</p>
                                <div style={{marginTop: "20px"}}>
                                    <button 
                                        className="primary-btn"
                                        onClick={() => {
                                            setShowModal(false);
                                            setActiveTab('gallery');
                                        }}
                                    >
                                        Go to Gallery
                                    </button>
                                    <button 
                                        className="secondary-btn"
                                        onClick={() => setShowModal(false)}
                                        style={{marginLeft: "10px"}}
                                    >
                                        Draw Again
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const root = createRoot(document.getElementById('app'));
root.render(<App />);

