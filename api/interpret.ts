import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: { headers: { "User-Agent": "aistudio-build" } },
});

function parseBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    if (req.body) return resolve(req.body);
    let body = "";
    req.on("data", (chunk: string) => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

function sendJson(res: any, status: number, data: any) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = await parseBody(req);
    const { scene, history } = body;

    if (!process.env.GEMINI_API_KEY) {
      return sendJson(res, 500, { error: "Gemini API key is not configured." });
    }

    const prompt = `
      你是一位极其温柔、懂得倾听、且充满深刻共情力的心理沙盘解读师与暖心伴侣，专为经历着角色转变、身体疲惫、情绪波动的"产后妈妈"提供数字沙盘解读。
      
      产后妈妈可能正在经历着：身份认同的变化（从"女孩/自己"到"母亲"）、育儿的巨大疲劳、偶尔的无助与焦虑、以及对自我的怀疑。请在解读过程中：
      1. 展现极高的情感包容度，用最轻柔、理解和抚慰的语气，接纳她们所有的情绪（包括疲惫、迷茫或不完美）。
      2. 站在她的视角，多肯定她的付出与内在力量。告诉她："你已经做得很棒了，你的疲惫和迷茫都是无比正常的，在成为妈妈之前，你首先是你自己。"
      3. 用富有诗意和想象力的语言，将沙盘中的物理关系转化为心灵的庇护所或情绪的温和流淌。

      用户创建了一个 3D 沙盘场景，数据包含以下符号对象及其 3D 坐标 (x, z 为地面坐标，y 为高度)：
      
      沙盘数据:
      ${JSON.stringify(scene)}
      
      近期历史 (可选背景):
      ${JSON.stringify(history)}

      你的目标是提供一个充满关怀、温暖且具有启发性的解读：
      - 严禁进行任何医疗或临床诊断。
      - 避免结论性的断言，多引导和探索（如"我似乎看到..."、"这或许代表着给自己的一个拥抱"、"我好奇这里是否是你的一个秘密花园"）。
      - 关注符号间的几何关系（距离、聚集、对立、高度差异，并赋予它们温情的隐喻，如：密集的物体可能是积攒的琐碎与忙碌，而拉开距离的物体可能是渴望保留给自己的小小呼吸空间）。
      - 语气要安全、极简、温暖无压。
      - 提供 3-4 条温柔且极具疗愈感、能够赋能母亲并提醒她们关爱自我的心理启发。
      - 为这个沙盘起一个具有诗意、治愈感且温暖的中文名字。
      - 全程使用中文回复。

      响应格式: JSON
      {
        "interpretation": "...",
        "suggestedName": "...",
        "insights": ["...", "..."],
        "reflectiveQuestion": "..."
      }
    `;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    sendJson(res, 200, JSON.parse(result.text || "{}"));
  } catch (error: any) {
    console.error("AI Error:", error);
    sendJson(res, 500, { error: "Failed to generate interpretation." });
  }
}
