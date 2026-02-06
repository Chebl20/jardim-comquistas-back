export interface Goal {
  id: number;
  title: string;
  year: number;
  description?: string | null;
  completed: boolean;
  // progresso (0 a 100)
  progress: number;
  // datas
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
}
