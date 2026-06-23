import { GoogleGenAI } from '@google/genai';

export async function analyzeCommitsAndGeneratePost(commits, apiKey, model = 'gemini-2.5-flash', additionalInstruction = '') {
  if (!apiKey) {
    throw new Error('Gemini API Key is not configured.');
  }

  const ai = new GoogleGenAI({ apiKey });

  const commitsText = commits.map(c => `- [${c.date}] (${c.hash}) ${c.message}`).join('\n');

  let systemInstructions = `
You are an expert developer relations (DevRel) and tech content creator.
Your task is to analyze a list of recent git commit messages, determine if there is anything of substance (features, bug fixes, major refactors, optimizations), and if so, write an engaging LinkedIn post.

Rules:
1. Score the commits from 1 to 5 based on how interesting/valuable they are for a technical audience:
   - 1: Only trivial commits (e.g. chore, format, bump versions, typos).
   - 2: Basic refactoring, minor fixes, small documentation updates.
   - 3: Standard features, significant bug fixes, or helpful improvements.
   - 4: Large features, performance optimizations, major codebase improvements.
   - 5: Outstanding achievements, launching a new project, huge architectural overhauls, or highly impactful milestones.
2. If the score is 4 or 5, craft a compelling LinkedIn post that:
   - Starts with a strong hook.
   - Explains the technical challenge or what was built in a concise, human way (avoid dry lists of commits).
   - Explains the impact or value.
   - Includes relevant, subtle hashtags (2-3 max).
   - Sounds authentic, professional, but enthusiastic. Avoid generic marketing jargon.
3. If the score is less than 4, still generate a potential post (in case the user wants to post it anyway) but keep the score low.
4. Output MUST be valid JSON adhering strictly to the schema provided.
`;

  if (additionalInstruction) {
    systemInstructions += `\nCRITICAL: You MUST also follow these additional instructions from the user:\n${additionalInstruction}\n`;
  }

  const prompt = `
Analyze the following commits:
${commitsText}
`;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        systemInstruction: systemInstructions,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            score: { type: 'INTEGER' },
            category: { type: 'STRING' },
            explanation: { type: 'STRING' },
            linkedinPost: { type: 'STRING' }
          },
          required: ['score', 'category', 'explanation', 'linkedinPost']
        }
      }
    });

    const resultText = response.text;
    return JSON.parse(resultText);
  } catch (err) {
    throw new Error(`Gemini API error: ${err.message}`);
  }
}
