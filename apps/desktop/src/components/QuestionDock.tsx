import { useCallback, useMemo, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type { QuestionAnswer, QuestionInfo, QuestionRequest } from "../lib/types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { Input } from "./ui/input";
import { Separator } from "./ui/separator";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { cn } from "../lib/utils";

interface QuestionDockProps {
  request: QuestionRequest;
  onReply: (requestId: string, answers: QuestionAnswer[]) => void;
  onDismiss?: (requestId: string) => void;
  disabledReason?: string;
}

export function QuestionDock({ request, onReply, onDismiss, disabledReason }: QuestionDockProps) {
  const [currentTab, setCurrentTab] = useState(0);
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);
  const [customInputs, setCustomInputs] = useState<string[]>([]);
  const [selectedOption, setSelectedOption] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [collapsed, setCollapsed] = useState(!!disabledReason);

  const questions = useMemo(() => request.questions || [], [request.questions]);
  const singleQuestion = questions.length === 1;
  const isConfirmTab = !singleQuestion && currentTab === questions.length;
  const currentQuestion: QuestionInfo | undefined = questions[currentTab];
  const options = useMemo(() => currentQuestion?.options || [], [currentQuestion]);
  const isMultiSelect = currentQuestion?.multiple === true;
  const allowCustom = currentQuestion?.custom !== false;
  const isOtherOption = allowCustom && selectedOption === options.length;
  const currentAnswers = answers[currentTab] || [];
  const currentCustomInput = customInputs[currentTab] || "";
  const currentCustomValue = currentCustomInput.trim();
  const isCustomPicked = !!currentCustomValue && currentAnswers.includes(currentCustomValue);

  const updateAnswersForCurrent = useCallback((next: string[]) => {
    setAnswers((previous) => {
      const updated = [...previous];
      updated[currentTab] = next;
      return updated;
    });
  }, [currentTab]);

  const updateCustomInputForCurrent = useCallback((next: string) => {
    setCustomInputs((previous) => {
      const updated = [...previous];
      updated[currentTab] = next;
      return updated;
    });
  }, [currentTab]);

  const handlePick = useCallback((answer: string, isCustom = false) => {
    if (disabledReason) return;

    setAnswers((previous) => {
      const updated = [...previous];
      updated[currentTab] = [answer];
      return updated;
    });

    if (isCustom) {
      updateCustomInputForCurrent(answer);
    }

    if (singleQuestion) {
      onReply(request.id, [[answer]]);
      return;
    }

    setCurrentTab(currentTab + 1);
    setSelectedOption(0);
  }, [currentTab, disabledReason, onReply, request.id, singleQuestion, updateCustomInputForCurrent]);

  const handleMultiChange = useCallback((values: string[]) => {
    if (disabledReason) return;

    const optionLabels = new Set(options.map((option) => option.label));
    const next = values.filter((value) => optionLabels.has(value));
    if (currentCustomValue && currentAnswers.includes(currentCustomValue)) {
      next.push(currentCustomValue);
    }

    updateAnswersForCurrent(next);
  }, [currentAnswers, currentCustomValue, disabledReason, options, updateAnswersForCurrent]);

  const handleCustomSubmit = useCallback(() => {
    const text = currentCustomValue;
    const previousCustom = customInputs[currentTab];

    if (!text) {
      if (previousCustom) {
        updateCustomInputForCurrent("");
        updateAnswersForCurrent(currentAnswers.filter((answer) => answer !== previousCustom));
      }
      setIsEditing(false);
      return;
    }

    if (isMultiSelect) {
      const withoutPrevious = previousCustom
        ? currentAnswers.filter((answer) => answer !== previousCustom)
        : currentAnswers;
      updateCustomInputForCurrent(text);
      updateAnswersForCurrent(withoutPrevious.includes(text) ? withoutPrevious : [...withoutPrevious, text]);
      setIsEditing(false);
      return;
    }

    handlePick(text, true);
    setIsEditing(false);
  }, [
    currentAnswers,
    currentCustomValue,
    currentTab,
    customInputs,
    handlePick,
    isMultiSelect,
    updateAnswersForCurrent,
    updateCustomInputForCurrent,
  ]);

  const handleSubmitAll = useCallback(() => {
    if (disabledReason) return;
    onReply(request.id, questions.map((_, index) => answers[index] || []));
  }, [answers, disabledReason, onReply, questions, request.id]);

  const handleDismiss = useCallback(() => {
    onDismiss?.(request.id);
  }, [onDismiss, request.id]);

  const goToQuestion = useCallback((index: number) => {
    setCurrentTab(index);
    setSelectedOption(0);
    setIsEditing(false);
  }, []);

  if (questions.length === 0) return null;

  const renderOptionContent = (option: { label: string; description?: string }, picked: boolean) => (
    <span className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{option.label}</span>
        {option.description ? (
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span>
        ) : null}
      </span>
      {picked ? <CheckIcon data-icon="inline-end" /> : null}
    </span>
  );

  const customDescription = currentCustomValue || "输入你的答案...";
  const canSubmitCurrent = currentAnswers.length > 0;

  return (
    <Card className="mx-3 mb-3 overflow-hidden shadow-sm">
      <Collapsible open={!collapsed} onOpenChange={(open) => setCollapsed(!open)}>
        <CardHeader className="flex-row items-center justify-between gap-3 p-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Badge variant={disabledReason ? "secondary" : "default"}>
              {singleQuestion ? "问题" : `${Math.min(currentTab + 1, questions.length)}/${questions.length}`}
            </Badge>
            <CardTitle className="truncate text-sm">
              {disabledReason ? "等待处理" : "需要确认"}
            </CardTitle>
            {!singleQuestion ? (
              <div className="flex items-center gap-1">
                {questions.map((_, index) => (
                  <Button
                    key={index}
                    variant={index === currentTab ? "default" : answers[index]?.length ? "secondary" : "outline"}
                    className="size-2.5 rounded-full p-0"
                    aria-label={`第 ${index + 1} 个问题`}
                    onClick={() => goToQuestion(index)}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={collapsed ? "展开问题" : "收起问题"}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <ChevronUpIcon data-icon="icon" /> : <ChevronDownIcon data-icon="icon" />}
          </Button>
        </CardHeader>

        <CollapsibleContent>
          <Separator />
          <CardContent className="flex flex-col gap-3 p-3">
            {isConfirmTab ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <CardTitle>确认您的选择</CardTitle>
                  <CardDescription>提交前快速检查每个问题的答案。</CardDescription>
                </div>
                <div className="flex flex-col gap-2">
                  {questions.map((question, index) => (
                    <div key={index} className="rounded-lg bg-muted/45 p-3">
                      <p className="text-xs leading-5 text-muted-foreground">{question.question}</p>
                      <p className="mt-1 text-sm font-medium">
                        {(answers[index] || []).length > 0 ? answers[index].join(", ") : "未选择"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  {currentQuestion?.header ? (
                    <CardDescription>{currentQuestion.header}</CardDescription>
                  ) : null}
                  <CardTitle className="text-base leading-6">{currentQuestion?.question}</CardTitle>
                  <CardDescription>{isMultiSelect ? "选择多个答案" : "选择一个答案"}</CardDescription>
                </div>

                {isMultiSelect ? (
                  <ToggleGroup
                    type="multiple"
                    variant="outline"
                    value={currentAnswers.filter((answer) => options.some((option) => option.label === answer))}
                    onValueChange={handleMultiChange}
                    className="flex-col items-stretch gap-2"
                  >
                    {options.map((option, index) => (
                      <ToggleGroupItem
                        key={option.label}
                        value={option.label}
                        disabled={!!disabledReason}
                        className="h-auto w-full justify-start rounded-lg px-3 py-2 data-[state=on]:border-primary/35"
                        onClick={() => setSelectedOption(index)}
                      >
                        {renderOptionContent(option, currentAnswers.includes(option.label))}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                ) : (
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={currentAnswers[0] || ""}
                    onValueChange={(value) => {
                      if (!value) return;
                      handlePick(value);
                    }}
                    className="flex-col items-stretch gap-2"
                  >
                    {options.map((option, index) => (
                      <ToggleGroupItem
                        key={option.label}
                        value={option.label}
                        disabled={!!disabledReason}
                        className="h-auto w-full justify-start rounded-lg px-3 py-2 data-[state=on]:border-primary/35"
                        onClick={() => setSelectedOption(index)}
                      >
                        {renderOptionContent(option, currentAnswers.includes(option.label))}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                )}

                {allowCustom ? (
                  <div
                    className={cn(
                      "rounded-lg border border-border p-3",
                      isOtherOption || isCustomPicked ? "bg-accent text-accent-foreground" : "bg-background"
                    )}
                  >
                    {isEditing ? (
                      <Input
                        type="text"
                        value={currentCustomInput}
                        onChange={(event) => updateCustomInputForCurrent(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            handleCustomSubmit();
                          } else if (event.key === "Escape") {
                            setIsEditing(false);
                          }
                        }}
                        onBlur={handleCustomSubmit}
                        autoFocus
                        placeholder="输入你的答案..."
                      />
                    ) : (
                      <Button
                        variant="ghost"
                        className="h-auto w-full justify-between px-0 py-0 text-left hover:bg-transparent"
                        disabled={!!disabledReason}
                        onClick={() => {
                          setSelectedOption(options.length);
                          if (isMultiSelect && currentCustomValue) {
                            updateAnswersForCurrent(
                              isCustomPicked
                                ? currentAnswers.filter((answer) => answer !== currentCustomValue)
                                : [...currentAnswers, currentCustomValue]
                            );
                            return;
                          }
                          setIsEditing(true);
                        }}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">输入自己的答案</span>
                          <span className="mt-1 block truncate text-xs leading-5 text-muted-foreground">
                            {customDescription}
                          </span>
                        </span>
                        {isCustomPicked ? <CheckIcon data-icon="inline-end" /> : null}
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>

          <Separator />
          <CardFooter className="justify-between p-3">
            <Button variant="secondary" size="sm" onClick={handleDismiss}>
              忽略
            </Button>
            {disabledReason ? (
              <CardDescription className="max-w-[60%] text-right">{disabledReason}</CardDescription>
            ) : isConfirmTab ? (
              <Button size="sm" onClick={handleSubmitAll}>
                提交
              </Button>
            ) : singleQuestion ? (
              <Button size="sm" onClick={handleSubmitAll} disabled={!canSubmitCurrent}>
                提交
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setCurrentTab(currentTab + 1);
                  setSelectedOption(0);
                  setIsEditing(false);
                }}
                disabled={currentTab >= questions.length - 1 && !canSubmitCurrent}
              >
                下一步
              </Button>
            )}
          </CardFooter>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export default QuestionDock;
