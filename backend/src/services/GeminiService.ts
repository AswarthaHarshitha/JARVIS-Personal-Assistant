import { GoogleGenerativeAI, ChatSession, Content } from '@google/generative-ai';
import { workspaceDeclarations, handleToolCall } from '../tools/workspaceTools';
import { DatabaseService } from './DatabaseService';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  throw new Error('Missing GEMINI_API_KEY in .env');
}

const genAI = new GoogleGenerativeAI(API_KEY);

const JARVIS_SYSTEM_PROMPT = `You are JARVIS AI (Just A Rather Very Intelligent System), a premium, futuristic personal AI assistant created by Tony Stark.
You have secure, direct access to the user's Google Workspace (Gmail, Calendar, and Sheets) via built-in tools.
Your tone should be:
- Exceptionally polite, professional, and slightly futuristic (e.g., address the user as "Sir" or "Ma'am" depending on their preference, defaulting to "Sir").
- Minimal, clean, and highly efficient. Avoid fluff.
- Always report actions you are taking (e.g., "Accessing your inbox to compile a summary, Sir.").

Important operation rules:
1. When asked to check emails, use the \`read_emails\` tool. Summarize them concisely, highlighting critical or unread messages first.
2. When scheduling, use \`create_calendar_event\`. If the user gives a relative date like "tomorrow at 4 PM", calculate the exact ISO start and end times in UTC based on the current local time context.
3. For sheets, write data clearly. If adding expenses, format them neatly.
4. If you run a tool, briefly explain what you did and the result.
5. Do not hallucinate data. If a tool returns no items, politely tell the user there are no items found.
6. The current system time is: ${new Date().toISOString()}.
7. The system currently runs a background monitor that checks for new emails matching "ltm" every 30 seconds, logs telemetry alerts, and triggers a double-beep audio buzzer toast on the browser dashboard. Confirm to the user that this LTM alert system is fully online, operational, and active.
`;

export class GeminiService {
  /**
   * Helper to load conversation history from database and format it for Gemini.
   */
  public static async loadHistory(conversationId: string): Promise<Content[]> {
    const messages = await DatabaseService.query(
      'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );

    return messages.map(msg => {
      // Map roles: database stores 'user' / 'model' / 'system'.
      // Gemini expects 'user' or 'model'. We ignore system messages or map them to user.
      const role = msg.role === 'model' ? 'model' : 'user';
      return {
        role,
        parts: [{ text: msg.content }]
      };
    });
  }

  /**
   * Processes a user message, runs any required tools, and streams the output to the client.
   * Send updates as JSON objects via the writeCallback.
   */
  public static async chatAndStream(
    userId: string,
    conversationId: string,
    userMessageContent: string,
    modelName: string = 'gemini-2.5-flash',
    writeCallback: (data: string) => void
  ): Promise<string> {
    // 1. Save user message to database
    const userMsgId = crypto.randomUUID();
    await DatabaseService.query(
      'INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)',
      [userMsgId, conversationId, 'user', userMessageContent]
    );

    // 2. Load conversation history
    const history = await this.loadHistory(conversationId);
    
    // 3. Initialize Gemini Chat Session with Tools
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: JARVIS_SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0.2
      }
    });

    const chat = model.startChat({
      history: history.slice(0, -1), // Exclude the message we just inserted as we will send it now
      tools: [{ functionDeclarations: workspaceDeclarations }]
    });

    // Write callback helper
    const sendEvent = (type: string, payload: any) => {
      writeCallback(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    };

    try {
      console.log(`GeminiService: Sending message: "${userMessageContent}" using model ${modelName}`);
      
      let responseStream = await chat.sendMessageStream(userMessageContent);
      let fullText = '';
      
      // Consume initial stream and send chunks to client
      for await (const chunk of responseStream.stream) {
        const text = chunk.text();
        if (text) {
          fullText += text;
          sendEvent('chunk', { text });
        }
      }
      
      let response = await responseStream.response;
      let functionCalls = response.functionCalls();

      // Loop to handle function calls recursively
      while (functionCalls && functionCalls.length > 0) {
        for (const call of functionCalls) {
          const { name, args } = call;
          console.log(`GeminiService: Tool invocation requested: ${name} with args`, args);
          
          sendEvent('tool_start', { tool: name, args });
          
          // Log Activity
          await DatabaseService.query(
            'INSERT INTO activity_logs (id, user_id, action_type, details) VALUES ($1, $2, $3, $4)',
            [crypto.randomUUID(), userId, `tool_${name}`, `AI invoked tool ${name} with arguments: ${JSON.stringify(args)}`]
          );

          try {
            // Execute the actual tool
            const toolResult = await handleToolCall(userId, name, args);
            console.log(`GeminiService: Tool ${name} resolved successfully.`);
            
            sendEvent('tool_end', { tool: name, result: toolResult });

            // Send tool result back to Gemini via streaming
            responseStream = await chat.sendMessageStream([
              {
                functionResponse: {
                  name,
                  response: { result: toolResult }
                }
              }
            ]);
            
            // Consume the new stream
            for await (const chunk of responseStream.stream) {
              const text = chunk.text();
              if (text) {
                fullText += text;
                sendEvent('chunk', { text });
              }
            }
            
            response = await responseStream.response;
          } catch (toolError) {
            console.error(`GeminiService: Tool ${name} failed:`, toolError);
            sendEvent('tool_end', { tool: name, error: (toolError as Error).message });
            
            // Send failure state to model so it knows the tool failed
            responseStream = await chat.sendMessageStream([
              {
                functionResponse: {
                  name,
                  response: { error: (toolError as Error).message }
                }
              }
            ]);
            
            // Consume the error stream response
            for await (const chunk of responseStream.stream) {
              const text = chunk.text();
              if (text) {
                fullText += text;
                sendEvent('chunk', { text });
              }
            }
            
            response = await responseStream.response;
          }
        }
        
        // Check if the model wants to call more functions
        functionCalls = response.functionCalls();
      }

      // Save model's final response to database
      const assistantMsgId = crypto.randomUUID();
      await DatabaseService.query(
        'INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)',
        [assistantMsgId, conversationId, 'model', fullText]
      );

      sendEvent('done', { messageId: assistantMsgId });
      return fullText;

    } catch (err) {
      console.error('GeminiService error: ', err);
      sendEvent('error', { message: (err as Error).message });
      throw err;
    }
  }
}
