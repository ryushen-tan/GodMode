export type Generate2DRequest = {
  imageUrl: string;
  prompt?: string;
};

export type Generate2DResult = {
  imageUrl: string;
  id?: string;
  autoDescription?: string;
  finalPrompt?: string;
};
