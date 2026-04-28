import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
} from "react-native";
import type { QuestionRequest, QuestionAnswer, QuestionInfo } from "../types";

interface QuestionDockProps {
  request: QuestionRequest;
  onReply: (requestId: string, answers: QuestionAnswer[]) => void;
  onDismiss?: (requestId: string) => void;
  disabledReason?: string;
  submitState?: 'idle' | 'submitting' | 'submitted' | 'failed';
  submitError?: string;
}

export function QuestionDock({ request, onReply, onDismiss, disabledReason, submitState = 'idle', submitError }: QuestionDockProps) {
  const [currentTab, setCurrentTab] = useState(0);
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);
  const [customInputs, setCustomInputs] = useState<string[]>([]);
  const [selectedOption, setSelectedOption] = useState<number>(0);
  const [isEditing, setIsEditing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const questions = useMemo(() => request.questions || [], [request.questions]);
  const singleQuestion = useMemo(() => questions.length === 1, [questions.length]);
  const isConfirmTab = useMemo(() => !singleQuestion && currentTab === questions.length, [singleQuestion, currentTab, questions.length]);

  const currentQuestion: QuestionInfo | undefined = questions[currentTab];
  const options = useMemo(() => currentQuestion?.options || [], [currentQuestion]);
  const isMultiSelect = useMemo(() => currentQuestion?.multiple === true, [currentQuestion]);
  const allowCustom = useMemo(() => currentQuestion?.custom !== false, [currentQuestion]);
  const isOtherOption = useMemo(() => allowCustom && selectedOption === options.length, [allowCustom, selectedOption, options.length]);
  const locked = !!disabledReason || submitState === 'submitting' || submitState === 'submitted';

  const currentCustomInput = customInputs[currentTab] || "";
  const isCustomPicked = useMemo(() => {
    if (!currentCustomInput) return false;
    return (answers[currentTab] || []).includes(currentCustomInput);
  }, [currentCustomInput, answers, currentTab]);

  const isOptionSelected = useCallback((optionLabel: string) => {
    return (answers[currentTab] || []).includes(optionLabel);
  }, [answers, currentTab]);

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
  }, [answers, currentTab, customInputs, singleQuestion, request.id, onReply, locked]);

  const handleToggle = useCallback((answer: string) => {
    if (locked) return;
    const existing = answers[currentTab] || [];
    const index = existing.indexOf(answer);
    let next: string[];

    if (index === -1) {
      next = [...existing, answer];
    } else {
      next = existing.filter((_, i) => i !== index);
    }

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
    if (isMultiSelect) {
      handleToggle(opt.label);
    } else {
      handlePick(opt.label);
    }
  }, [allowCustom, options, isMultiSelect, currentCustomInput, isCustomPicked, handleToggle, handlePick, locked]);

  const handleCustomSubmit = useCallback(() => {
    const text = currentCustomInput.trim();
    const prev = customInputs[currentTab];

    if (!text) {
      if (prev) {
        const newCustomInputs = [...customInputs];
        newCustomInputs[currentTab] = "";
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
      if (prev) {
        next = next.filter((x) => x !== prev);
      }
      if (!next.includes(text)) {
        next.push(text);
      }

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
  }, [currentCustomInput, customInputs, currentTab, answers, isMultiSelect, options.length, singleQuestion, locked]);

  const handleSubmitAll = useCallback(() => {
    if (locked) return;
    const finalAnswers = questions.map((_, i) => answers[i] || []);
    if (finalAnswers.some((answer) => answer.length === 0)) return;
    onReply(request.id, finalAnswers);
  }, [questions, answers, request.id, onReply, locked]);

  const handleDismiss = useCallback(() => {
    if (onDismiss) {
      onDismiss(request.id);
    }
  }, [onDismiss, request.id]);

  if (questions.length === 0) return null;

  return (
    <View style={styles.container}>
      <Pressable style={styles.header} onPress={() => setCollapsed(!collapsed)}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {singleQuestion
              ? (currentQuestion?.header || currentQuestion?.question || "问题").slice(0, 20)
              : `${Math.min(currentTab + 1, questions.length)}/${questions.length} ${(currentQuestion?.header || currentQuestion?.question || "个问题").slice(0, 16)}`}
          </Text>
          {!singleQuestion && (
            <View style={styles.tabs}>
              {questions.map((_, idx) => (
                <Pressable
                  key={idx}
                  style={[
                    styles.tab,
                    idx === currentTab && styles.tabActive,
                    answers[idx]?.length > 0 && styles.tabAnswered,
                  ]}
                  onPress={(e) => {
                    e.stopPropagation();
                    setCurrentTab(idx);
                    setSelectedOption(0);
                  }}
                />
              ))}
            </View>
          )}
        </View>
        <Text style={styles.toggle}>{collapsed ? "▲" : "▼"}</Text>
      </Pressable>

      {!collapsed && (
        <>
          <View style={styles.body}>
            {isConfirmTab ? (
              <View>
                <Text style={styles.confirmTitle}>确认您的选择</Text>
                {questions.map((q, idx) => (
                  <Pressable
                    key={idx}
                    style={styles.confirmItem}
                    onPress={() => {
                      if (locked) return;
                      setCurrentTab(idx);
                      setSelectedOption(0);
                    }}
                  >
                    <Text style={styles.confirmQ}>{q.question}</Text>
                    <Text style={styles.confirmA}>
                      {(answers[idx] || []).length > 0
                        ? answers[idx].join(", ")
                        : <Text style={styles.confirmEmpty}>未选择</Text>
                      }
                    </Text>
                    {!locked ? <Text style={styles.confirmEdit}>点击修改</Text> : null}
                  </Pressable>
                ))}
              </View>
            ) : (
              <>
                <View style={styles.questionHeader}>
                  {currentQuestion?.header ? (
                    <Text style={styles.headerText}>{currentQuestion.header}</Text>
                  ) : null}
                  <Text style={styles.questionText}>{currentQuestion?.question}</Text>
                </View>

                <Text style={styles.hint}>
                  {isMultiSelect ? "选择多个答案" : "选择一个答案"}
                </Text>

                <View style={styles.options}>
                  {options.map((opt, idx) => (
                    <Pressable
                      key={idx}
                      style={[
                        styles.option,
                        locked ? styles.optionDisabled : null,
                        idx === selectedOption && styles.optionSelected,
                        isOptionSelected(opt.label) && styles.optionPicked,
                      ]}
                      onPress={() => handleSelectOption(idx)}
                    >
                      <View style={styles.optionRadio}>
                        {isMultiSelect ? (
                          <View style={[
                            styles.checkbox,
                            isOptionSelected(opt.label) && styles.checkboxChecked,
                          ]}>
                            {isOptionSelected(opt.label) && (
                              <Text style={styles.checkmark}>✓</Text>
                            )}
                          </View>
                        ) : (
                          <View style={[
                            styles.radio,
                            isOptionSelected(opt.label) && styles.radioChecked,
                          ]} />
                        )}
                      </View>
                      <View style={styles.optionContent}>
                        <Text style={styles.optionLabel}>{opt.label}</Text>
                        {opt.description ? (
                          <Text style={styles.optionDesc}>{opt.description}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  ))}

                  {allowCustom && (
                    <Pressable
                      style={[
                        styles.option,
                        styles.optionCustom,
                        locked ? styles.optionDisabled : null,
                        isOtherOption && styles.optionSelected,
                        isCustomPicked && styles.optionPicked,
                      ]}
                      onPress={() => handleSelectOption(options.length)}
                    >
                      <View style={styles.optionRadio}>
                        {isMultiSelect ? (
                          <View style={[
                            styles.checkbox,
                            isCustomPicked && styles.checkboxChecked,
                          ]}>
                            {isCustomPicked && (
                              <Text style={styles.checkmark}>✓</Text>
                            )}
                          </View>
                        ) : (
                          <View style={[
                            styles.radio,
                            isCustomPicked && styles.radioChecked,
                          ]} />
                        )}
                      </View>
                      <View style={styles.optionContent}>
                        {isEditing ? (
                          <TextInput
                            style={styles.customInput}
                            value={currentCustomInput}
                            onChangeText={(text) => {
                              const newCustomInputs = [...customInputs];
                              newCustomInputs[currentTab] = text;
                              setCustomInputs(newCustomInputs);
                              if (!isMultiSelect) {
                                const trimmed = text.trim();
                                const newAnswers = [...answers];
                                newAnswers[currentTab] = trimmed ? [trimmed] : [];
                                setAnswers(newAnswers);
                              }
                            }}
                            onSubmitEditing={handleCustomSubmit}
                            onBlur={handleCustomSubmit}
                            autoFocus
                            placeholder="输入你的答案..."
                            placeholderTextColor="#9da5b4"
                          />
                        ) : (
                          <>
                            <Text style={styles.optionLabel}>输入自己的答案</Text>
                            <Text style={styles.optionDesc}>
                              {currentCustomInput || "输入你的答案..."}
                            </Text>
                          </>
                        )}
                      </View>
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </View>

          <View style={styles.footer}>
            <Pressable style={[styles.btnSecondary, locked ? styles.btnDisabled : null]} onPress={handleDismiss} disabled={locked}>
              <Text style={styles.btnSecondaryText}>忽略</Text>
            </Pressable>
            {submitState === 'submitting' ? (
              <Text style={styles.submitState}>提交中...</Text>
            ) : submitState === 'submitted' ? (
              <Text style={styles.submitState}>已提交，等待回复...</Text>
            ) : submitState === 'failed' ? (
              <View style={styles.retryWrap}>
                <Text style={styles.submitError} numberOfLines={1}>{submitError || '提交失败'}</Text>
                <Pressable style={styles.btnPrimary} onPress={handleSubmitAll}>
                  <Text style={styles.btnPrimaryText}>重试</Text>
                </Pressable>
              </View>
            ) : disabledReason ? (
              <Text style={styles.disabledReason}>{disabledReason}</Text>
            ) : isConfirmTab ? (
              <Pressable
                style={[styles.btnPrimary, answers.some((answer) => !answer || answer.length === 0) ? styles.btnDisabled : null]}
                onPress={handleSubmitAll}
                disabled={answers.some((answer) => !answer || answer.length === 0)}
              >
                <Text style={styles.btnPrimaryText}>提交</Text>
              </Pressable>
            ) : singleQuestion ? (
              <Pressable
                style={[styles.btnPrimary, (answers[0] || []).length === 0 ? styles.btnDisabled : null]}
                onPress={handleSubmitAll}
                disabled={(answers[0] || []).length === 0}
              >
                <Text style={styles.btnPrimaryText}>提交</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[
                  styles.btnPrimary,
                  (currentTab >= questions.length - 1 && (answers[currentTab] || []).length === 0) && styles.btnDisabled,
                ]}
                onPress={() => {
                  setCurrentTab(currentTab + 1);
                  setSelectedOption(0);
                }}
                disabled={currentTab >= questions.length - 1 && (answers[currentTab] || []).length === 0}
              >
                <Text style={styles.btnPrimaryText}>下一步</Text>
              </Pressable>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    marginHorizontal: 12,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 3,
      },
      web: {
        boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
      },
    }),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1e1e1e",
  },
  tabs: {
    flexDirection: "row",
    gap: 6,
  },
  tab: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#c0c0c0",
  },
  tabActive: {
    backgroundColor: "#243447",
  },
  tabAnswered: {
    backgroundColor: "#2da44e",
  },
  toggle: {
    fontSize: 12,
    color: "#9da5b4",
  },
  body: {
    padding: 14,
  },
  questionHeader: {
    marginBottom: 8,
  },
  headerText: {
    fontSize: 12,
    color: "#9da5b4",
    marginBottom: 4,
  },
  questionText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1e1e1e",
    lineHeight: 22,
  },
  hint: {
    fontSize: 12,
    color: "#9da5b4",
    marginBottom: 12,
  },
  options: {
    gap: 8,
  },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 8,
    backgroundColor: "#fafafa",
  },
  optionSelected: {
    borderColor: "#243447",
    backgroundColor: "rgba(36, 52, 71, 0.08)",
  },
  optionDisabled: {
    opacity: 0.62,
  },
  optionPicked: {
    borderColor: "#2da44e",
    backgroundColor: "rgba(45, 164, 78, 0.06)",
  },
  optionCustom: {
    // no extra styles
  },
  optionRadio: {
    marginTop: 2,
  },
  radio: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: "#c0c0c0",
    borderRadius: 10,
  },
  radioChecked: {
    borderColor: "#243447",
    backgroundColor: "#243447",
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: "#c0c0c0",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    borderColor: "#243447",
    backgroundColor: "#243447",
  },
  checkmark: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  optionContent: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#1e1e1e",
    lineHeight: 20,
  },
  optionDesc: {
    fontSize: 12,
    color: "#9da5b4",
    marginTop: 2,
    lineHeight: 18,
  },
  customInput: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 14,
    color: "#1e1e1e",
    backgroundColor: "#fff",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
  },
  btnPrimary: {
    backgroundColor: "#1e1e1e",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  btnPrimaryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  btnSecondary: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  btnSecondaryText: {
    color: "#666",
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  confirmTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1e1e1e",
    marginBottom: 10,
  },
  confirmItem: {
    padding: 10,
    backgroundColor: "#fafafa",
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 8,
    marginBottom: 8,
  },
  confirmQ: {
    fontSize: 12,
    color: "#9da5b4",
    marginBottom: 4,
  },
  confirmA: {
    fontSize: 14,
    color: "#1e1e1e",
    fontWeight: "500",
  },
  confirmEmpty: {
    color: "#cf6679",
    fontStyle: "italic",
  },
  confirmEdit: { color: "#607287", fontSize: 11, marginTop: 6 },
  disabledReason: {
    color: "#9da5b4",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "right",
    flexShrink: 1,
  },
  submitState: {
    color: "#607287",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "right",
    flexShrink: 1,
  },
  retryWrap: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  submitError: { color: "#cf6679", fontSize: 12, flexShrink: 1, maxWidth: 180 },
});

export default QuestionDock;
