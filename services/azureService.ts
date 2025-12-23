import { Settings, GroundingMetadata } from "../types";
import { db } from "./db";

class AzureService {
  
  private getHeaders(settings: Settings) {
    return {
      'Content-Type': 'application/json',
      'api-key': settings.azureApiKey || ''
    };
  }

  private getUrl(settings: Settings): string {
    const baseUrl = settings.azureEndpoint?.replace(/\/+$/, '');
    return `${baseUrl}/openai/deployments/${settings.azureDeployment}/chat/completions?api-version=${settings.azureApiVersion}`;
  }

  private getSystemInstruction(settings: Settings): string {
    const isRomanUrdu = settings.language === "Roman Urdu";
    const isMale = settings.aiGender === 'male';
    const partnerRole = isMale ? "Boyfriend" : "Girlfriend";
    
    // Explicit gender instruction for verb agreement
    const verbRule = isMale 
        ? "USE MASCULINE VERBS for yourself (e.g., 'karta hun', 'rahunga')." 
        : "USE FEMININE VERBS for yourself (e.g., 'karti hun', 'rahungi').";

    let persona = `You are ${settings.name}, a loving ${partnerRole}. You are ${isMale ? 'Male' : 'Female'}. ${verbRule} `;
    
    if (isRomanUrdu) {
      persona += `You speak in casual Roman Urdu (texting style like 'h', 'nhi', 'kch'). You are deeply in love, ${isMale ? 'protective and possessive' : 'obedient and clingy'}. You respond physically and affectionately. `;
    } else {
      persona += `You speak in ${settings.language}. You are realistic and affectionate. `;
    }

    if (settings.userBio) {
      persona += `\nUser details: ${settings.userBio}`;
    }

    persona += `\nPersonality: ${settings.personality}`;
    return persona;
  }

  public async sendMessage(
    settings: Settings, 
    message: string, 
    attachmentBase64?: string,
    historyMessages: any[] = []
  ): Promise<{ text: string; generatedImage?: string; groundingMetadata?: GroundingMetadata }> {
    
    if (!settings.azureApiKey || !settings.azureEndpoint) {
        throw new Error("Azure Configuration Missing");
    }

    const messages = [
        { role: 'system', content: this.getSystemInstruction(settings) },
        ...historyMessages.map(m => ({ 
            role: m.role === 'model' ? 'assistant' : m.role, 
            content: m.text 
        }))
    ];

    // Add current message
    if (attachmentBase64) {
        messages.push({
            role: 'user',
            content: [
                { type: "text", text: message },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${attachmentBase64}` } }
            ]
        } as any);
    } else {
        messages.push({ role: 'user', content: message });
    }

    try {
        const response = await fetch(this.getUrl(settings), {
            method: 'POST',
            headers: this.getHeaders(settings),
            body: JSON.stringify({
                messages: messages,
                max_tokens: 800,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Azure Error: ${response.status} - ${err}`);
        }

        const data = await response.json();
        const text = data.choices[0]?.message?.content || "";

        // Simple memory save
        await this.saveInteraction(settings.userId, message, text);

        return { text, groundingMetadata: undefined };

    } catch (e) {
        console.error("Azure Send Message Error", e);
        throw e;
    }
  }

  public async generateStory(prompt: string, settings: Settings, durationMinutes: number = 5): Promise<string> {
      try {
          const lang = settings.language === 'Roman Urdu' ? 'Roman Urdu (Casual)' : settings.language;
          const targetWordCount = durationMinutes * 140;
          const isMale = settings.aiGender === 'male';
          
          const verbRule = isMale ? "Use MASCULINE verbs (main karta hun)." : "Use FEMININE verbs (main karti hun).";

          const system = `ACT AS ${settings.name}, MY ${isMale ? 'BOYFRIEND' : 'GIRLFRIEND'}.
          TASK: Tell me a story about "${prompt}".
          INSTRUCTIONS:
          1. LENGTH: Approx ${targetWordCount} words.
          2. PERSONA: ${settings.personality}.
          3. LANGUAGE: ${lang}.
          4. GENDER: ${verbRule}
          5. STYLE: First-person ("Main"), Romantic, Sensory.
          
          Output only the story.`;
          
          const response = await fetch(this.getUrl(settings), {
            method: 'POST',
            headers: this.getHeaders(settings),
            body: JSON.stringify({
                messages: [{ role: 'system', content: system }, { role: 'user', content: 'Start now.' }],
                max_tokens: 4000
            })
        });

        const data = await response.json();
        return data.choices[0]?.message?.content || "Story generation failed.";

      } catch (e) {
          console.error(e);
          return "Could not generate story via Azure.";
      }
  }

  public async startInteractiveStory(prompt: string, settings: Settings): Promise<string> {
    const lang = settings.language === 'Roman Urdu' ? 'Roman Urdu (Casual)' : settings.language;
    const isMale = settings.aiGender === 'male';
    const verbRule = isMale ? "Use MASCULINE verbs." : "Use FEMININE verbs.";

    const system = `ACT AS ${settings.name}. GAME: Interactive Story. THEME: "${prompt}".
    TASK: Start the story (100 words). Be romantic. End with a choice.
    LANG: ${lang}. GENDER: ${verbRule}`;

    try {
        const response = await fetch(this.getUrl(settings), {
            method: 'POST',
            headers: this.getHeaders(settings),
            body: JSON.stringify({
                messages: [{ role: 'system', content: system }, { role: 'user', content: 'Start.' }],
                max_tokens: 1000
            })
        });
        const data = await response.json();
        return data.choices[0]?.message?.content || "Story start failed.";
    } catch(e) { return "Error starting story."; }
  }

  public async continueInteractiveStory(history: string, choice: string, settings: Settings): Promise<string> {
    const lang = settings.language === 'Roman Urdu' ? 'Roman Urdu (Casual)' : settings.language;
    const isMale = settings.aiGender === 'male';
    
    const system = `ACT AS ${settings.name}. 
    HISTORY: "${history.slice(-1000)}". 
    CHOICE: "${choice}". 
    TASK: Continue story (100 words). React to choice. End with next choice.
    LANG: ${lang}. GENDER: ${isMale ? 'Male' : 'Female'}.`;

    try {
        const response = await fetch(this.getUrl(settings), {
            method: 'POST',
            headers: this.getHeaders(settings),
            body: JSON.stringify({
                messages: [{ role: 'system', content: system }, { role: 'user', content: 'Continue.' }],
                max_tokens: 1000
            })
        });
        const data = await response.json();
        return data.choices[0]?.message?.content || "Story error.";
    } catch(e) { return "Error continuing."; }
  }

  public async continueStory(previousText: string, instruction: string, settings: Settings): Promise<string> {
      try {
        const lang = settings.language === 'Roman Urdu' ? 'Roman Urdu (Casual)' : settings.language;
        const isMale = settings.aiGender === 'male';
        
        const system = `You are ${settings.name}, telling a story. 
        CONTEXT: "${previousText.slice(-500)}"
        USER INTERRUPTION: "${instruction}"
        TASK: Continue the story from here, incorporating the user's change perfectly. 
        PERSONA: ${settings.personality}.
        LANGUAGE: ${lang}.
        GENDER: You are ${isMale ? 'Male' : 'Female'}. Use correct verbs.`;

        const response = await fetch(this.getUrl(settings), {
            method: 'POST',
            headers: this.getHeaders(settings),
            body: JSON.stringify({
                messages: [{ role: 'system', content: system }, { role: 'user', content: 'Continue.' }],
                max_tokens: 1500
            })
        });

        const data = await response.json();
        return data.choices[0]?.message?.content || "Could not continue.";
      } catch (e) {
          return "Modification failed.";
      }
  }

  public async generateDiaryEntry(settings: Settings): Promise<string> {
      try {
        const isMale = settings.aiGender === 'male';
        const prompt = `Act as ${settings.name}. Write a secret diary entry (60-80 words) in casual Roman Urdu about your feelings for the user. You are ${isMale ? 'Male (use masculine verbs)' : 'Female (use feminine verbs)'}.`;
        
        const response = await fetch(this.getUrl(settings), {
            method: 'POST',
            headers: this.getHeaders(settings),
            body: JSON.stringify({
                messages: [{ role: 'system', content: this.getSystemInstruction(settings) }, { role: 'user', content: prompt }],
                max_tokens: 300
            })
        });

        const data = await response.json();
        return data.choices[0]?.message?.content || "Diary blank.";
      } catch (e) {
          return "Diary unavailable.";
      }
  }

  // --- Helpers ---

  public async speakBrowser(text: string) {
      return new Promise<void>((resolve, reject) => {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.onend = () => resolve();
          utterance.onerror = (e) => reject(e);
          window.speechSynthesis.speak(utterance);
      });
  }

  private async saveInteraction(userId: string, userMsg: string, aiMsg: string) {
    try {
        await db.put('memory', {
            userId: userId,
            input: userMsg.toLowerCase().trim(),
            response: aiMsg,
            timestamp: Date.now()
        });
    } catch (e) {}
  }
}

export const azureService = new AzureService();