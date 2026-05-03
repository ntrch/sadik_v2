import {
  Briefcase, Code, Coffee, Users, BookOpen, Pencil, Brain, Zap,
  Target, Flame, Rocket, Sparkles, Lightbulb, Music, Gamepad2, Dumbbell,
  Heart, Smile, Moon, Sun, Cloud, Leaf, Flower2, TreePine,
  Utensils, Soup, Pizza, Cake, Wine, Beer, Apple, Carrot,
  Palette, Camera, Film, Headphones, Mic, Radio, Tv, Podcast,
  Book, GraduationCap, School, Library, FileText, ClipboardList, NotebookPen, StickyNote,
  Phone, MessageSquare, Mail, Video, Presentation, BarChart2, PieChart, TrendingUp,
  Home, Plane, Car, Bike, Ship, Map, MapPin, Compass,
  Bed, Baby, PawPrint, Bird, Fish, Dog, Cat, Rabbit,
  Wrench, Hammer, Settings, Cog, Terminal, Cpu, Database, Server,
  ShoppingCart, CreditCard, Wallet, DollarSign, Gift, Package, Tag, Store,
  Clock, Timer, Calendar, Hourglass, Bell, BellOff, Star, Trophy,
  Activity, Heart as HeartPulse, Stethoscope, Pill, Syringe, Thermometer,
  Snowflake, Droplet, Umbrella, Rainbow, Wind, Waves,
  Repeat, Droplets, GlassWater, Salad, Watch, RefreshCw,
  type LucideIcon,
} from 'lucide-react';

/**
 * Curated icon library for mode customization.
 * Line-style icons from lucide, matching navbar aesthetic.
 * Organized by semantic category for the picker UI.
 */
export const ICON_CATEGORIES: { name: string; icons: { key: string; Icon: LucideIcon }[] }[] = [
  {
    name: 'İş & Odak',
    icons: [
      { key: 'briefcase', Icon: Briefcase }, { key: 'code', Icon: Code },
      { key: 'target',    Icon: Target    }, { key: 'brain',     Icon: Brain },
      { key: 'zap',       Icon: Zap       }, { key: 'flame',     Icon: Flame },
      { key: 'rocket',    Icon: Rocket    }, { key: 'sparkles',  Icon: Sparkles },
      { key: 'lightbulb', Icon: Lightbulb }, { key: 'pencil',    Icon: Pencil },
      { key: 'terminal',  Icon: Terminal  }, { key: 'cpu',       Icon: Cpu },
      { key: 'database',  Icon: Database  }, { key: 'server',    Icon: Server },
      { key: 'wrench',    Icon: Wrench    }, { key: 'hammer',    Icon: Hammer },
      { key: 'cog',       Icon: Cog       }, { key: 'settings',  Icon: Settings },
    ],
  },
  {
    name: 'Eğitim',
    icons: [
      { key: 'book',          Icon: Book },          { key: 'bookopen',      Icon: BookOpen },
      { key: 'graduationcap', Icon: GraduationCap }, { key: 'school',        Icon: School },
      { key: 'library',       Icon: Library },       { key: 'filetext',      Icon: FileText },
      { key: 'clipboardlist', Icon: ClipboardList }, { key: 'notebookpen',   Icon: NotebookPen },
      { key: 'stickynote',    Icon: StickyNote },
    ],
  },
  {
    name: 'İletişim',
    icons: [
      { key: 'phone',        Icon: Phone },        { key: 'messagesquare', Icon: MessageSquare },
      { key: 'mail',         Icon: Mail },         { key: 'video',         Icon: Video },
      { key: 'users',        Icon: Users },        { key: 'presentation',  Icon: Presentation },
      { key: 'barchart2',    Icon: BarChart2 },    { key: 'piechart',      Icon: PieChart },
      { key: 'trendingup',   Icon: TrendingUp },
    ],
  },
  {
    name: 'Dinlenme',
    icons: [
      { key: 'coffee',    Icon: Coffee },    { key: 'moon',      Icon: Moon },
      { key: 'bed',       Icon: Bed },       { key: 'music',     Icon: Music },
      { key: 'gamepad2',  Icon: Gamepad2 },  { key: 'heart',     Icon: Heart },
      { key: 'smile',     Icon: Smile },     { key: 'headphones',Icon: Headphones },
      { key: 'mic',       Icon: Mic },       { key: 'radio',     Icon: Radio },
      { key: 'tv',        Icon: Tv },        { key: 'podcast',   Icon: Podcast },
      { key: 'film',      Icon: Film },      { key: 'camera',    Icon: Camera },
      { key: 'palette',   Icon: Palette },
    ],
  },
  {
    name: 'Spor & Sağlık',
    icons: [
      { key: 'dumbbell',    Icon: Dumbbell },    { key: 'activity',    Icon: Activity },
      { key: 'heartpulse',  Icon: HeartPulse },  { key: 'stethoscope', Icon: Stethoscope },
      { key: 'pill',        Icon: Pill },        { key: 'syringe',     Icon: Syringe },
      { key: 'thermometer', Icon: Thermometer },
    ],
  },
  {
    name: 'Yemek',
    icons: [
      { key: 'utensils', Icon: Utensils }, { key: 'soup',    Icon: Soup },
      { key: 'pizza',    Icon: Pizza },    { key: 'cake',    Icon: Cake },
      { key: 'wine',     Icon: Wine },     { key: 'beer',    Icon: Beer },
      { key: 'apple',    Icon: Apple },    { key: 'carrot',  Icon: Carrot },
    ],
  },
  {
    name: 'Doğa & Hava',
    icons: [
      { key: 'sun',       Icon: Sun },       { key: 'cloud',     Icon: Cloud },
      { key: 'snowflake', Icon: Snowflake }, { key: 'droplet',   Icon: Droplet },
      { key: 'umbrella',  Icon: Umbrella },  { key: 'rainbow',   Icon: Rainbow },
      { key: 'wind',      Icon: Wind },      { key: 'waves',     Icon: Waves },
      { key: 'leaf',      Icon: Leaf },      { key: 'flower2',   Icon: Flower2 },
      { key: 'treepine',  Icon: TreePine },
    ],
  },
  {
    name: 'Yaşam',
    icons: [
      { key: 'home',     Icon: Home },     { key: 'plane',    Icon: Plane },
      { key: 'car',      Icon: Car },      { key: 'bike',     Icon: Bike },
      { key: 'ship',     Icon: Ship },     { key: 'map',      Icon: Map },
      { key: 'mappin',   Icon: MapPin },   { key: 'compass',  Icon: Compass },
      { key: 'baby',     Icon: Baby },     { key: 'pawprint', Icon: PawPrint },
      { key: 'dog',      Icon: Dog },      { key: 'cat',      Icon: Cat },
      { key: 'rabbit',   Icon: Rabbit },   { key: 'bird',     Icon: Bird },
      { key: 'fish',     Icon: Fish },
    ],
  },
  {
    name: 'Alışveriş',
    icons: [
      { key: 'shoppingcart', Icon: ShoppingCart }, { key: 'creditcard', Icon: CreditCard },
      { key: 'wallet',       Icon: Wallet },       { key: 'dollarsign', Icon: DollarSign },
      { key: 'gift',         Icon: Gift },         { key: 'package',    Icon: Package },
      { key: 'tag',          Icon: Tag },          { key: 'store',      Icon: Store },
    ],
  },
  {
    name: 'Zaman & Ödül',
    icons: [
      { key: 'clock',     Icon: Clock },     { key: 'timer',    Icon: Timer },
      { key: 'calendar',  Icon: Calendar },  { key: 'hourglass',Icon: Hourglass },
      { key: 'bell',      Icon: Bell },      { key: 'belloff',  Icon: BellOff },
      { key: 'star',      Icon: Star },      { key: 'trophy',   Icon: Trophy },
      { key: 'repeat',    Icon: Repeat },    { key: 'refreshcw', Icon: RefreshCw },
      { key: 'watch',     Icon: Watch },
    ],
  },
  {
    name: 'Sağlık & Su',
    icons: [
      { key: 'droplets',   Icon: Droplets },  { key: 'glasswater', Icon: GlassWater },
      { key: 'salad',      Icon: Salad },
    ],
  },
];

/** Flat map for O(1) lookup by key. */
export const ICON_MAP: Record<string, LucideIcon> = (() => {
  const out: Record<string, LucideIcon> = {};
  ICON_CATEGORIES.forEach((c) => c.icons.forEach(({ key, Icon }) => { out[key] = Icon; }));
  return out;
})();

/** Default icon key per built-in preset mode. */
export const DEFAULT_PRESET_ICONS: Record<string, string> = {
  working:  'briefcase',
  coding:   'code',
  break:    'coffee',
  meeting:  'users',
  writing:  'pencil',
  learning: 'graduationcap',
  design:   'palette',
  reading:  'bookopen',
  gaming:   'gamepad2',
};

export function getIconByKey(key: string | undefined | null): LucideIcon | null {
  if (!key) return null;
  return ICON_MAP[key] ?? null;
}
