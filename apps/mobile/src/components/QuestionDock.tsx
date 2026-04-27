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
}

export function QuestionDock({ request, onReply, onDismiss }: QuestionDockProps) {
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

  const currentCustomInput = customInputs[currentTab] || "";
  const isCustomPicked = useMemo(() => {
    if (!currentCustomInput) return false;
    return (answers[currentTab] || []).includes(currentCustomInput);
  }, [currentCustomInput, answers, currentTab]);

  const isOptionSelected = useCallback((optionLabel: string) => {
    return (answers[currentTab] || []).includes(optionLabel);
  }, [answers, currentTab]);

  const handlePick = useCallback((answer: string, isCustom: boolean = false) => {
    const newAnswers = [...answers];
    newAnswers[currentTab] = [answer];
    setAnswers(newAnswers);

    if (isCustom) {
      const newCustomInputs = [...customInputs];
      newCustomInputs[currentTab] = answer;
      setCustomInputs(newCustomInputs);
    }

    if (singleQuestion) {
      onReply(request.id, [[answer]]);
      return;
    }

    setCurrentTab(currentTab + 1);
    setSelectedOption(0);
  }, [answers, currentTab, customInputs, singleQuestion, request.id, onReply]);

  const handleToggle = useCallback((answer: string) => {
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
  }, [answers, currentTab]);

  const handleSelectOption = useCallback((index: number) => {
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
  }, [allowCustom, options, isMultiSelect, currentCustomInput, isCustomPicked, handleToggle, handlePick]);

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
      handlePick(text, true);
      setIsEditing(false);
    }
  }, [currentCustomInput, customInputs, currentTab, answers, isMultiSelect, handlePick]);

  const handleSubmitAll = useCallback(() => {
    const finalAnswers = questions.map((_, i) => answers[i] || []);
    onReply(request.id, finalAnswers);
  }, [questions, answers, request.id, onReply]);

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
          <Text style={styles.title}>
            {singleQuestion ? "" : `${Math.min(currentTab + 1, questions.length)}/${questions.length} `}
            个问题
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
                  <View key={idx} style={styles.confirmItem}>
                    <Text style={styles.confirmQ}>{q.question}</Text>
                    <Text style={styles.confirmA}>
                      {(answers[idx] || []).length > 0
                        ? answers[idx].join(", ")
                        : <Text style={styles.confirmEmpty}>未选择</Text>
                      }
                    </Text>
                  </View>
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
            <Pressable style={styles.btnSecondary} onPress={handleDismiss}>
              <Text style={styles.btnSecondaryText}>忽略</Text>
            </Pressable>
            {isConfirmTab ? (
              <Pressable style={styles.btnPrimary} onPress={handleSubmitAll}>
                <Text style={styles.btnPrimaryText}>提交</Text>
              </Pressable>
            ) : singleQuestion ? null : (
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
    backgroundColor: "#0066b8",
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
    borderColor: "#0066b8",
    backgroundColor: "rgba(0, 102, 184, 0.08)",
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
    borderColor: "#0066b8",
    backgroundColor: "#0066b8",
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
    borderColor: "#0066b8",
    backgroundColor: "#0066b8",
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
});

export default QuestionDock;