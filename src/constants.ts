import { 
  User, 
  Baby, 
  TreePine, 
  Waves, 
  Home, 
  Cat, 
  Dog, 
  Moon, 
  Sun, 
  Flower, 
  Cloud, 
  Heart, 
  Mountain,
  Bird,
  Anchor,
  Shield,
  Infinity,
  Car,
  Building,
  Milestone
} from "lucide-react";

export interface SandboxObject {
  id: string;
  type: string;
  x: number;
  z: number; // 3D uses X/Z for ground plane
  y: number; // Height
  scale: number;
  rotation: number;
  label: string;
}

export interface SandtraySession {
  id: string;
  timestamp: number;
  objects: SandboxObject[];
  terrainHeight?: number[]; // Flat array for heightmap
  terrainType?: number[];   // Flat array for material type
  interpretation?: string;
  name?: string;
  insights?: string[];
  weather: 'sunny' | 'rainy' | 'snowy';
}

export const CATEGORIES = [
  { id: 'sculpt', label: '建构', icon: Milestone },
  { id: 'nature', label: '自然', icon: TreePine },
  { id: 'living', label: '生命', icon: User },
];

export const SYMBOLS: Record<string, any[]> = {
  nature: [
    { type: "tree", icon: TreePine, label: "树木" },
    { type: "flower", icon: Flower, label: "花朵" },
    { type: "stone", icon: Milestone, label: "石子" },
  ],
  living: [
    { type: "person_male", icon: User, label: "男性" },
    { type: "person_female", icon: User, label: "女性" },
    { type: "cat", icon: Cat, label: "小猫" },
    { type: "dog", icon: Dog, label: "小狗" },
  ],
};
