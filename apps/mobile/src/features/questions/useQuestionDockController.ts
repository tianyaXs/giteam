import { useCallback, useMemo, useState } from 'react';
import type { QuestionAnswer, QuestionInfo, QuestionRequest } from '../../types';

type UseQuestionDockControllerParams = {
  request: QuestionRequest;
  locked: boolean;
  onReply: (requestId: string, answers: QuestionAnswer[]) => void;
  onDismiss?: (requestId: string) => void;
};

export function useQuestionDockController({
  request,
  locked,
  onReply,
  onDismiss
}: UseQuestionDockControllerParams) {
  const [currentTab, setCurrentTab] = useState(0);
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);
  const [customInputs, setCustomInputs] = useState<string[]>([]);
  const [selectedOption, setSelectedOption] = useState<number>(0);
  const [isEditing, setIsEditing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const questions = useMemo(() => request.questions || [], [request.questions]);
  const singleQuestion = useMemo(() => questions.length === 1, [questions.length]);
  const isConfirmTab = useMemo(() => !singleQuestion && currentTab === questions.length, [currentTab, questions.length, singleQuestion]);
  const currentQuestion: QuestionInfo | undefined = questions[currentTab];
  const options = useMemo(() => currentQuestion?.options || [], [currentQuestion]);
  const isMultiSelect = useMemo(() => currentQuestion?.multiple === true, [currentQuestion]);
  const allowCustom = useMemo(() => currentQuestion?.custom !== false, [currentQuestion]);
  const isOtherOption = useMemo(() => allowCustom && selectedOption === options.length, [allowCustom, options.length, selectedOption]);
  const currentCustomInput = customInputs[currentTab] || '';
  const isCustomPicked = useMemo(() => {
    if (!currentCustomInput) return false;
    return (answers[currentTab] || []).includes(currentCustomInput);
  }, [answers, currentCustomInput, currentTab]);

  const isOptionSelected = useCallback((optionLabel: string) => {
    return (answers[currentTab] || []).includes(optionLabel);
  }, [answers, currentTab]);

  const updateCurrentCustomInput = useCallback((text: string) => {
    const newCustomInputs = [...customInputs];
    newCustomInputs[currentTab] = text;
    setCustomInputs(newCustomInputs);
    if (!isMultiSelect) {
      const trimmed = text.trim();
      const newAnswers = [...answers];
      newAnswers[currentTab] = trimmed ? [trimmed] : [];
      setAnswers(newAnswers);
    }
  }, [answers, currentTab, customInputs, isMultiSelect]);

  const goToQuestionTab = useCallback((index: number) => {
    setCurrentTab(index);
    setSelectedOption(0);
  }, []);

  const handlePick = useCallback((answer: string, isCustom: boolean = false) => {
    if (locked) return;
    const newAnswers = [...answers];
    newAnswers[currentTab] = [answer];
    setAnswers(newAnswers);
    if (isCustom) {
      const newCustomInputs = [...customInputs];
      newCustomInputs[currentTab] = answer;
      setCustomInputs(newCustomInputs);
    }
    if (singleQuestion) return;
    setCurrentTab(currentTab + 1);
    setSelectedOption(0);
  }, [answers, currentTab, customInputs, locked, singleQuestion]);

  const handleToggle = useCallback((answer: string) => {
    if (locked) return;
    const existing = answers[currentTab] || [];
    const index = existing.indexOf(answer);
    const next = index === -1 ? [...existing, answer] : existing.filter((_, i) => i !== index);
    const newAnswers = [...answers];
    newAnswers[currentTab] = next;
    setAnswers(newAnswers);
  }, [answers, currentTab, locked]);

  const handleSelectOption = useCallback((index: number) => {
    if (locked) return;
    if (allowCustom && index === options.length) {
      setSelectedOption(index);
      if (!isMultiSelect) {
        setIsEditing(true);
      } else if (currentCustomInput && isCustomPicked) {
        handleToggle(currentCustomInput);
      } else {
        setIsEditing(true);
      }
      return;
    }
    const opt = options[index];
    if (!opt) return;
    setSelectedOption(index);
    if (isMultiSelect) handleToggle(opt.label);
    else handlePick(opt.label);
  }, [allowCustom, currentCustomInput, handlePick, handleToggle, isCustomPicked, isMultiSelect, locked, options]);

  const handleCustomSubmit = useCallback(() => {
    const text = currentCustomInput.trim();
    const prev = customInputs[currentTab];
    if (!text) {
      if (prev) {
        const newCustomInputs = [...customInputs];
        newCustomInputs[currentTab] = '';
        setCustomInputs(newCustomInputs);
        const newAnswers = [...answers];
        newAnswers[currentTab] = (newAnswers[currentTab] || []).filter((x) => x !== prev);
        setAnswers(newAnswers);
      }
      setIsEditing(false);
      return;
    }
    if (isMultiSelect) {
      const newCustomInputs = [...customInputs];
      newCustomInputs[currentTab] = text;
      setCustomInputs(newCustomInputs);
      const existing = answers[currentTab] || [];
      let next = [...existing];
      if (prev) next = next.filter((x) => x !== prev);
      if (!next.includes(text)) next.push(text);
      const newAnswers = [...answers];
      newAnswers[currentTab] = next;
      setAnswers(newAnswers);
      setIsEditing(false);
    } else {
      const newCustomInputs = [...customInputs];
      newCustomInputs[currentTab] = text;
      setCustomInputs(newCustomInputs);
      const newAnswers = [...answers];
      newAnswers[currentTab] = [text];
      setAnswers(newAnswers);
      setSelectedOption(options.length);
      setIsEditing(false);
      if (!singleQuestion) setCurrentTab(currentTab + 1);
    }
  }, [answers, currentCustomInput, currentTab, customInputs, isMultiSelect, options.length, singleQuestion]);

  const handleSubmitAll = useCallback(() => {
    if (locked) return;
    const finalAnswers = questions.map((_, i) => answers[i] || []);
    if (finalAnswers.some((answer) => answer.length === 0)) return;
    onReply(request.id, finalAnswers);
  }, [answers, locked, onReply, questions, request.id]);

  const handleDismiss = useCallback(() => {
    if (onDismiss) onDismiss(request.id);
  }, [onDismiss, request.id]);

  const goNext = useCallback(() => {
    setCurrentTab(currentTab + 1);
    setSelectedOption(0);
  }, [currentTab]);

  return {
    allowCustom,
    answers,
    collapsed,
    currentCustomInput,
    currentQuestion,
    currentTab,
    goNext,
    goToQuestionTab,
    handleCustomSubmit,
    handleDismiss,
    handleSelectOption,
    handleSubmitAll,
    isConfirmTab,
    isCustomPicked,
    isEditing,
    isMultiSelect,
    isOptionSelected,
    isOtherOption,
    options,
    questions,
    selectedOption,
    setCollapsed,
    singleQuestion,
    updateCurrentCustomInput
  };
}
