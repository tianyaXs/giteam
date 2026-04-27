import { useState, useMemo, useCallback } from "react";
import type { QuestionRequest, QuestionAnswer, QuestionInfo } from "../lib/types";

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

  const handleSelectOption = useCallback(() => {
    if (isOtherOption) {
      if (!isMultiSelect) {
        setIsEditing(true);
        return;
      }
      if (currentCustomInput && isCustomPicked) {
        handleToggle(currentCustomInput);
        return;
      }
      setIsEditing(true);
      return;
    }
    
    const opt = options[selectedOption];
    if (!opt) return;
    
    if (isMultiSelect) {
      handleToggle(opt.label);
    } else {
      handlePick(opt.label);
    }
  }, [isOtherOption, isMultiSelect, currentCustomInput, isCustomPicked, options, selectedOption, handleToggle, handlePick]);

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
    <div className="gt-question-dock">
      <div className="gt-question-dock-header" onClick={() => setCollapsed(!collapsed)}>
        <div className="gt-question-dock-title">
          <span className="gt-question-dock-count">
            {singleQuestion ? "" : `${Math.min(currentTab + 1, questions.length)}/${questions.length} `}
            个问题
          </span>
          {!singleQuestion && (
            <span className="gt-question-dock-tabs">
              {questions.map((_, idx) => (
                <span
                  key={idx}
                  className={`gt-question-dock-tab ${idx === currentTab ? "active" : ""} ${answers[idx]?.length > 0 ? "answered" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentTab(idx);
                    setSelectedOption(0);
                  }}
                />
              ))}
            </span>
          )}
        </div>
        <button className="gt-question-dock-toggle" aria-label={collapsed ? "展开" : "收起"}>
          {collapsed ? "▲" : "▼"}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="gt-question-dock-body">
            {isConfirmTab ? (
              <div className="gt-question-confirm">
                <div className="gt-question-confirm-title">确认您的选择</div>
                <div className="gt-question-confirm-list">
                  {questions.map((q, idx) => (
                    <div key={idx} className="gt-question-confirm-item">
                      <div className="gt-question-confirm-q">{q.question}</div>
                      <div className="gt-question-confirm-a">
                        {(answers[idx] || []).length > 0 
                          ? answers[idx].join(", ") 
                          : <span className="gt-question-confirm-empty">未选择</span>
                        }
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="gt-question-header">
                  {currentQuestion?.header ? (
                    <div className="gt-question-header-text">{currentQuestion.header}</div>
                  ) : null}
                  <div className="gt-question-text">{currentQuestion?.question}</div>
                </div>
                
                <div className="gt-question-hint">
                  {isMultiSelect ? "选择多个答案" : "选择一个答案"}
                </div>

                <div className="gt-question-options">
                  {options.map((opt, idx) => (
                    <div
                      key={idx}
                      className={`gt-question-option ${idx === selectedOption ? "selected" : ""} ${isOptionSelected(opt.label) ? "picked" : ""}`}
                      onClick={() => {
                        setSelectedOption(idx);
                        if (isMultiSelect) {
                          handleToggle(opt.label);
                        } else {
                          handlePick(opt.label);
                        }
                      }}
                    >
                      <div className="gt-question-option-radio">
                        {isMultiSelect ? (
                          <div className={`gt-question-checkbox ${isOptionSelected(opt.label) ? "checked" : ""}`}>
                            {isOptionSelected(opt.label) && (
                              <svg viewBox="0 0 24 24" width="14" height="14">
                                <path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                        ) : (
                          <div className={`gt-question-radio ${isOptionSelected(opt.label) ? "checked" : ""}`} />
                        )}
                      </div>
                      <div className="gt-question-option-content">
                        <div className="gt-question-option-label">{opt.label}</div>
                        {opt.description ? (
                          <div className="gt-question-option-desc">{opt.description}</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  
                  {allowCustom && (
                    <div
                      className={`gt-question-option custom ${isOtherOption ? "selected" : ""} ${isCustomPicked ? "picked" : ""}`}
                      onClick={() => setSelectedOption(options.length)}
                    >
                      <div className="gt-question-option-radio">
                        {isMultiSelect ? (
                          <div className={`gt-question-checkbox ${isCustomPicked ? "checked" : ""}`}>
                            {isCustomPicked && (
                              <svg viewBox="0 0 24 24" width="14" height="14">
                                <path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                        ) : (
                          <div className={`gt-question-radio ${isCustomPicked ? "checked" : ""}`} />
                        )}
                      </div>
                      <div className="gt-question-option-content">
                        {isEditing ? (
                          <input
                            type="text"
                            className="gt-question-custom-input"
                            value={currentCustomInput}
                            onChange={(e) => {
                              const newCustomInputs = [...customInputs];
                              newCustomInputs[currentTab] = e.target.value;
                              setCustomInputs(newCustomInputs);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleCustomSubmit();
                              } else if (e.key === "Escape") {
                                setIsEditing(false);
                              }
                            }}
                            onBlur={handleCustomSubmit}
                            autoFocus
                            placeholder="输入你的答案..."
                          />
                        ) : (
                          <>
                            <div className="gt-question-option-label">输入自己的答案</div>
                            <div className="gt-question-option-desc">
                              {currentCustomInput || "输入你的答案..."}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="gt-question-dock-footer">
            <button className="gt-question-btn gt-question-btn-secondary" onClick={handleDismiss}>
              忽略
            </button>
            {isConfirmTab ? (
              <button className="gt-question-btn gt-question-btn-primary" onClick={handleSubmitAll}>
                提交
              </button>
            ) : singleQuestion ? null : (
              <button
                className="gt-question-btn gt-question-btn-primary"
                onClick={() => {
                  setCurrentTab(currentTab + 1);
                  setSelectedOption(0);
                }}
                disabled={currentTab >= questions.length - 1 && (answers[currentTab] || []).length === 0}
              >
                下一步
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default QuestionDock;