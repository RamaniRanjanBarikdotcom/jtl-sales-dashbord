import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
}

export class AskQuestionDto {
  @IsUUID() conversationId!: string;
  @IsString() @MaxLength(2000) question!: string;
  @IsOptional() @IsIn(['today','yesterday','this_week','last_week','this_month','last_month','this_year'])
  period?: string;
}

export class FeedbackDto {
  @IsUUID() messageId!: string;
  @IsIn([-1, 1]) rating!: -1 | 1;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
