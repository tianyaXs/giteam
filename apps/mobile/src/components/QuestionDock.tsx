import React, { useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from "react-native";
import type { QuestionRequest, QuestionAnswer } from "../types";
import { useQuestionDockController } from "../features/questions/useQuestionDockController";
import { useMobileTheme } from "../features/theme/ThemeProvider";

interface QuestionDockProps {
  request: QuestionRequest;
  onReply: (requestId: string, answers: QuestionAnswer[]) => void;
  onDismiss?: (requestId: string) => void;
  disabledReason?: string;
  submitState?: 'idle' | 'submitting' | 'submitted' | 'failed';
  submitError?: string;
}

export function QuestionDock({ request, onReply, onDismiss, disabledReason, submitState = 'idle', submitError }: QuestionDockProps) {
  const { height: windowHeight } = useWindowDimensions();
  const { colors } = useMobileTheme();
  const locked = !!disabledReason || submitState === 'submitting' || submitState === 'submitted';
  const {
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
  } = useQuestionDockController({
    request,
    locked,
    onReply,
    onDismiss
  });
  const denseOptions = options.length + (allowCustom ? 1 : 0) >= 5;
  const maxDockHeight = Math.max(360, Math.round(windowHeight * 0.68));
  const maxBodyHeight = Math.max(230, Math.round(windowHeight * 0.48));

  // ChatGPT 中性色板：容器/选项用 card 与 sidebar 分层，选中态统一用 primary 克制绿做点缀
  // （radio/checkbox/已答 tab/主按钮），替代原 GitHub-dark 蓝绿。跟随系统明暗。
  const styles = useMemo(() => StyleSheet.create({
    container: {
      backgroundColor: colors.card,
      borderRadius: 12,
      marginHorizontal: 12,
      marginBottom: 12,
      ...Platform.select({
        ios: {
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: colors.isDark ? 0.4 : 0.08,
          shadowRadius: 8,
        },
        android: {
          elevation: 3,
        },
        web: {
          boxShadow: colors.isDark ? "0 2px 12px rgba(0,0,0,0.45)" : "0 2px 12px rgba(0,0,0,0.08)",
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
      borderBottomColor: colors.border,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    title: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
    },
    tabs: {
      flexDirection: "row",
      gap: 6,
    },
    tab: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: colors.muted,
    },
    tabActive: {
      backgroundColor: colors.primary,
    },
    tabAnswered: {
      backgroundColor: colors.primary,
    },
    toggle: {
      fontSize: 12,
      color: colors.muted,
    },
    body: {},
    bodyContent: {
      padding: 14,
      paddingBottom: 10,
    },
    questionHeader: {
      marginBottom: 8,
    },
    headerText: {
      fontSize: 12,
      color: colors.muted,
      marginBottom: 4,
    },
    questionText: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.text,
      lineHeight: 22,
    },
    hint: {
      fontSize: 12,
      color: colors.muted,
      marginBottom: 12,
    },
    options: {
      gap: 6,
    },
    option: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.sidebar,
    },
    optionCompact: {
      alignItems: "center",
      paddingVertical: 7,
      paddingHorizontal: 10,
      gap: 8,
    },
    optionSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    optionDisabled: {
      opacity: 0.62,
    },
    optionPicked: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    optionCustom: {
      // no extra styles
    },
    optionRadio: {
      marginTop: 1,
    },
    radio: {
      width: 18,
      height: 18,
      borderWidth: 1.5,
      borderColor: colors.muted,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.card,
    },
    radioChecked: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    radioDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.primaryText,
    },
    checkbox: {
      width: 18,
      height: 18,
      borderWidth: 1.5,
      borderColor: colors.muted,
      borderRadius: 5,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.card,
    },
    checkboxChecked: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    checkmark: {
      color: colors.primaryText,
      fontSize: 11,
      fontWeight: "700",
      lineHeight: 14,
    },
    optionContent: {
      flex: 1,
    },
    optionLabel: {
      fontSize: 14,
      fontWeight: "500",
      color: colors.text,
      lineHeight: 20,
    },
    optionDesc: {
      fontSize: 12,
      color: colors.muted,
      marginTop: 2,
      lineHeight: 18,
    },
    customInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      fontSize: 14,
      color: colors.text,
      backgroundColor: colors.card,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    btnPrimary: {
      backgroundColor: colors.primary,
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 6,
    },
    btnPrimaryText: {
      color: colors.primaryText,
      fontSize: 14,
      fontWeight: "600",
    },
    btnSecondary: {
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    btnSecondaryText: {
      color: colors.muted,
      fontSize: 14,
    },
    btnDisabled: {
      opacity: 0.4,
    },
    confirmTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.text,
      marginBottom: 10,
    },
    confirmItem: {
      padding: 10,
      backgroundColor: colors.sidebar,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      marginBottom: 8,
    },
    confirmQ: {
      fontSize: 12,
      color: colors.muted,
      marginBottom: 4,
    },
    confirmA: {
      fontSize: 14,
      color: colors.text,
      fontWeight: "500",
    },
    confirmEmpty: {
      color: colors.danger,
      fontStyle: "italic",
    },
    confirmEdit: { color: colors.muted, fontSize: 11, marginTop: 6 },
    disabledReason: {
      color: colors.muted,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "right",
      flexShrink: 1,
    },
    submitState: {
      color: colors.muted,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "right",
      flexShrink: 1,
    },
    retryWrap: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
    submitError: { color: colors.danger, fontSize: 12, flexShrink: 1, maxWidth: 180 },
  }), [colors]);

  if (questions.length === 0) return null;

  return (
    <View style={[styles.container, { maxHeight: maxDockHeight }]}>
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
                    goToQuestionTab(idx);
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
          <ScrollView
            style={[styles.body, { maxHeight: maxBodyHeight }]}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {isConfirmTab ? (
              <View>
                <Text style={styles.confirmTitle}>确认您的选择</Text>
                {questions.map((q, idx) => (
                  <Pressable
                    key={idx}
                    style={styles.confirmItem}
                    onPress={() => {
                      if (locked) return;
                      goToQuestionTab(idx);
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
                  <Text style={styles.questionText} numberOfLines={denseOptions ? 3 : undefined}>{currentQuestion?.question}</Text>
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
                        denseOptions ? styles.optionCompact : null,
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
                          ]}>
                            {isOptionSelected(opt.label) ? <View style={styles.radioDot} /> : null}
                          </View>
                        )}
                      </View>
                      <View style={styles.optionContent}>
                        <Text style={styles.optionLabel} numberOfLines={denseOptions ? 1 : undefined}>{opt.label}</Text>
                        {opt.description ? (
                          <Text style={styles.optionDesc} numberOfLines={denseOptions ? 1 : 2}>{opt.description}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  ))}

                  {allowCustom && (
                    <Pressable
                      style={[
                        styles.option,
                        denseOptions ? styles.optionCompact : null,
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
                          ]}>
                            {isCustomPicked ? <View style={styles.radioDot} /> : null}
                          </View>
                        )}
                      </View>
                      <View style={styles.optionContent}>
                        {isEditing ? (
                          <TextInput
                            style={styles.customInput}
                            value={currentCustomInput}
                            onChangeText={updateCurrentCustomInput}
                            onSubmitEditing={handleCustomSubmit}
                            onBlur={handleCustomSubmit}
                            autoFocus
                            placeholder="输入你的答案..."
                            placeholderTextColor={colors.muted}
                          />
                        ) : (
                          <>
                            <Text style={styles.optionLabel} numberOfLines={1}>输入自己的答案</Text>
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
          </ScrollView>

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
                onPress={goNext}
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

export default QuestionDock;
