#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <Speech/Speech.h>
#import <dispatch/dispatch.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

extern void coworkany_native_asr_on_segment(const char *text, const char *locale, float confidence);
extern void coworkany_native_asr_log(const char *message);

#define MAX_CANDIDATES 3

static SFSpeechRecognizer *gRecognizers[MAX_CANDIDATES] = { nil };
static SFSpeechAudioBufferRecognitionRequest *gRequests[MAX_CANDIDATES] = { nil };
static SFSpeechRecognitionTask *gTasks[MAX_CANDIDATES] = { nil };
static NSString *gCandidateLocales[MAX_CANDIDATES] = { nil };
static NSMutableString *gCandidateTranscripts[MAX_CANDIDATES] = { nil };
static float gCandidateConfidences[MAX_CANDIDATES] = { 0 };
static BOOL gCandidateHasFinal[MAX_CANDIDATES] = { NO };
static NSTimeInterval gCandidateLastUpdateAt[MAX_CANDIDATES] = { 0 };
static NSUInteger gCandidateCount = 0;
static NSUInteger gRecognitionGeneration = 0;

static AVAudioEngine *gAudioEngine = nil;
static NSError *gRecognitionError = nil;
static dispatch_semaphore_t gCompletionSemaphore = nil;
static dispatch_source_t gFinalizeTimer = nil;
static BOOL gListening = NO;
static BOOL gStopping = NO;
static BOOL gSegmentEmitted = NO;

static void coworkany_log(NSString *message) {
    if (message == nil || message.length == 0) {
        return;
    }

    const char *utf8 = [message UTF8String];
    if (utf8 != NULL) {
        coworkany_native_asr_log(utf8);
    }
}

static char *coworkany_strdup(NSString *value) {
    if (value == nil) {
        return NULL;
    }

    const char *utf8 = [value UTF8String];
    if (utf8 == NULL) {
        return NULL;
    }

    return strdup(utf8);
}

static void coworkany_set_error(char **error_code, char **error_message, NSString *code, NSString *message) {
    if (error_code != NULL) {
        *error_code = coworkany_strdup(code);
    }
    if (error_message != NULL) {
        *error_message = coworkany_strdup(message);
    }
}

static BOOL coworkany_has_usage_description(NSString *key) {
    if (key == nil || key.length == 0) {
        return NO;
    }

    NSBundle *mainBundle = [NSBundle mainBundle];
    if (mainBundle == nil) {
        return NO;
    }

    id value = [mainBundle objectForInfoDictionaryKey:key];
    if (![value isKindOfClass:[NSString class]]) {
        return NO;
    }

    NSString *stringValue = [(NSString *)value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    return stringValue.length > 0;
}

static BOOL coworkany_has_required_privacy_descriptions(void) {
    return coworkany_has_usage_description(@"NSSpeechRecognitionUsageDescription")
        && coworkany_has_usage_description(@"NSMicrophoneUsageDescription");
}

static SFSpeechRecognizerAuthorizationStatus coworkany_request_speech_authorization(void) {
    SFSpeechRecognizerAuthorizationStatus status = [SFSpeechRecognizer authorizationStatus];
    if (status != SFSpeechRecognizerAuthorizationStatusNotDetermined) {
        return status;
    }

    __block SFSpeechRecognizerAuthorizationStatus resolved = SFSpeechRecognizerAuthorizationStatusNotDetermined;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus authStatus) {
        resolved = authStatus;
        dispatch_semaphore_signal(semaphore);
    }];
    dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
    return resolved;
}

static AVAuthorizationStatus coworkany_request_microphone_authorization(void) {
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    if (status != AVAuthorizationStatusNotDetermined) {
        return status;
    }

    __block BOOL granted = NO;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL accessGranted) {
        granted = accessGranted;
        dispatch_semaphore_signal(semaphore);
    }];
    dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
    return granted ? AVAuthorizationStatusAuthorized : AVAuthorizationStatusDenied;
}

static void coworkany_cancel_finalize_timer(void) {
    if (gFinalizeTimer != nil) {
        dispatch_source_cancel(gFinalizeTimer);
        gFinalizeTimer = nil;
    }
}

static void coworkany_reset_candidate_buffers(void) {
    for (NSUInteger i = 0; i < MAX_CANDIDATES; i++) {
        if (gCandidateTranscripts[i] != nil) {
            [gCandidateTranscripts[i] setString:@""];
        } else {
            gCandidateTranscripts[i] = [[NSMutableString alloc] init];
        }
        gCandidateConfidences[i] = 0.0f;
        gCandidateHasFinal[i] = NO;
        gCandidateLastUpdateAt[i] = 0;
    }
    gRecognitionError = nil;
}

static void coworkany_reset_state(void) {
    coworkany_cancel_finalize_timer();

    if (gAudioEngine != nil) {
        [gAudioEngine stop];
        AVAudioInputNode *inputNode = [gAudioEngine inputNode];
        if (inputNode != nil) {
            [inputNode removeTapOnBus:0];
        }
    }

    for (NSUInteger i = 0; i < MAX_CANDIDATES; i++) {
        [gTasks[i] cancel];
        gTasks[i] = nil;
        gRequests[i] = nil;
        gRecognizers[i] = nil;
        gCandidateLocales[i] = nil;
        gCandidateTranscripts[i] = nil;
        gCandidateConfidences[i] = 0.0f;
        gCandidateHasFinal[i] = NO;
    }

    gCandidateCount = 0;
    gRecognitionGeneration += 1;
    gAudioEngine = nil;
    gRecognitionError = nil;
    gCompletionSemaphore = nil;
    gListening = NO;
    gStopping = NO;
    gSegmentEmitted = NO;
}

static BOOL coworkany_string_contains_cjk(NSString *text) {
    for (NSUInteger i = 0; i < text.length; i++) {
        unichar ch = [text characterAtIndex:i];
        if ((ch >= 0x4E00 && ch <= 0x9FFF) || (ch >= 0x3400 && ch <= 0x4DBF)) {
            return YES;
        }
    }
    return NO;
}

static float coworkany_ascii_ratio(NSString *text) {
    NSUInteger considered = 0;
    NSUInteger asciiLetters = 0;
    for (NSUInteger i = 0; i < text.length; i++) {
        unichar ch = [text characterAtIndex:i];
        if ([[NSCharacterSet letterCharacterSet] characterIsMember:ch]) {
            considered += 1;
            if (ch < 128) {
                asciiLetters += 1;
            }
        }
    }

    if (considered == 0) {
        return 0.0f;
    }

    return (float)asciiLetters / (float)considered;
}

static float coworkany_average_confidence(SFTranscription *transcription) {
    NSArray<SFTranscriptionSegment *> *segments = transcription.segments;
    if (segments.count == 0) {
        return 0.0f;
    }

    float total = 0.0f;
    for (SFTranscriptionSegment *segment in segments) {
        total += segment.confidence;
    }
    return total / (float)segments.count;
}

static float coworkany_score_candidate(NSString *locale, NSString *text, float confidence) {
    if (text == nil || text.length == 0) {
        return -1000.0f;
    }

    float score = confidence;
    BOOL hasCjk = coworkany_string_contains_cjk(text);
    float asciiRatio = coworkany_ascii_ratio(text);

    if ([locale hasPrefix:@"zh"]) {
        score += hasCjk ? 0.35f : -0.25f;
        if (asciiRatio > 0.85f) {
            score -= 0.15f;
        }
    } else if ([locale hasPrefix:@"en"]) {
        score += hasCjk ? -0.35f : 0.15f;
        if (asciiRatio > 0.70f) {
            score += 0.10f;
        }
    }

    score += MIN((float)text.length / 48.0f, 0.12f);
    return score;
}

static void coworkany_emit_segment(NSString *text, NSString *locale, float confidence) {
    if (text == nil || text.length == 0) {
        return;
    }

    gSegmentEmitted = YES;
    const char *utf8 = [text UTF8String];
    const char *localeUtf8 = locale != nil ? [locale UTF8String] : NULL;
    if (utf8 != NULL) {
        coworkany_native_asr_on_segment(utf8, localeUtf8, confidence);
    }
}

static BOOL coworkany_is_no_speech_error(NSError *error) {
    if (error == nil) {
        return NO;
    }

    NSString *message = [[error.localizedDescription ?: @"" lowercaseString] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (message.length == 0) {
        return NO;
    }

    return [message containsString:@"no speech detected"];
}

static void coworkany_add_locale_candidate(NSMutableArray<NSString *> *candidates, NSString *locale) {
    if (locale == nil || locale.length == 0 || candidates.count >= MAX_CANDIDATES) {
        return;
    }
    if (![candidates containsObject:locale]) {
        [candidates addObject:locale];
    }
}

static NSArray<NSString *> *coworkany_build_locale_candidates(const char *hint) {
    NSString *hintValue = nil;
    if (hint != NULL) {
        hintValue = [[NSString stringWithUTF8String:hint] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    }

    if (hintValue.length > 0 && [hintValue caseInsensitiveCompare:@"auto"] != NSOrderedSame) {
        return @[hintValue];
    }

    NSMutableArray<NSString *> *candidates = [NSMutableArray array];
    NSString *systemLocale = [[NSLocale currentLocale] localeIdentifier];
    if ([systemLocale hasPrefix:@"zh"]) {
        coworkany_add_locale_candidate(candidates, @"zh-CN");
        coworkany_add_locale_candidate(candidates, @"en-US");
    } else if ([systemLocale hasPrefix:@"en"]) {
        coworkany_add_locale_candidate(candidates, @"en-US");
        coworkany_add_locale_candidate(candidates, @"zh-CN");
    } else {
        coworkany_add_locale_candidate(candidates, systemLocale);
        coworkany_add_locale_candidate(candidates, @"zh-CN");
        coworkany_add_locale_candidate(candidates, @"en-US");
    }

    if (candidates.count == 0) {
        [candidates addObject:@"en-US"];
    }

    return candidates;
}

static void coworkany_signal_completion_if_needed(void) {
    if (gStopping && gCompletionSemaphore != nil) {
        dispatch_semaphore_signal(gCompletionSemaphore);
    }
}

static bool coworkany_start_recognition_tasks(char **error_code, char **error_message);
static void coworkany_finalize_segment(void);

static void coworkany_schedule_finalize_timer(NSTimeInterval delayMs, NSString *reason) {
    coworkany_cancel_finalize_timer();
    if (!gListening) {
        return;
    }

    NSUInteger generation = gRecognitionGeneration;
    coworkany_log([NSString stringWithFormat:@"schedule_finalize reason=%@ delay_ms=%.0f generation=%lu", reason ?: @"unknown", delayMs, (unsigned long)generation]);

    gFinalizeTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    if (gFinalizeTimer == nil) {
        return;
    }

    dispatch_source_set_timer(
        gFinalizeTimer,
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delayMs * NSEC_PER_MSEC)),
        DISPATCH_TIME_FOREVER,
        (uint64_t)(50 * NSEC_PER_MSEC)
    );
    dispatch_source_set_event_handler(gFinalizeTimer, ^{
        if (generation != gRecognitionGeneration) {
            return;
        }
        coworkany_log([NSString stringWithFormat:@"finalize_timer_fired generation=%lu", (unsigned long)generation]);
        coworkany_finalize_segment();
    });
    dispatch_resume(gFinalizeTimer);
}

static NSInteger coworkany_select_best_candidate(void) {
    NSInteger bestIndex = -1;
    float bestScore = -1000.0f;

    for (NSUInteger i = 0; i < gCandidateCount; i++) {
        NSString *text = gCandidateTranscripts[i];
        if (text == nil || text.length == 0) {
            continue;
        }

        float score = coworkany_score_candidate(gCandidateLocales[i], text, gCandidateConfidences[i]);
        if (score > bestScore) {
            bestScore = score;
            bestIndex = (NSInteger)i;
        }
    }

    return bestIndex;
}

static void coworkany_finalize_segment(void) {
    coworkany_cancel_finalize_timer();

    NSInteger bestIndex = coworkany_select_best_candidate();
    NSTimeInterval ageMs = 0;
    if (bestIndex >= 0 && gCandidateLastUpdateAt[bestIndex] > 0) {
        ageMs = ([NSDate timeIntervalSinceReferenceDate] - gCandidateLastUpdateAt[bestIndex]) * 1000.0;
    }
    coworkany_log([NSString stringWithFormat:@"finalize_segment best_index=%ld stopping=%d age_ms=%.0f", (long)bestIndex, gStopping ? 1 : 0, ageMs]);
    if (bestIndex >= 0 && !gStopping) {
        coworkany_emit_segment(
            [gCandidateTranscripts[bestIndex] copy],
            gCandidateLocales[bestIndex],
            gCandidateConfidences[bestIndex]
        );
    }

    if (gStopping) {
        coworkany_signal_completion_if_needed();
        return;
    }

    if (!coworkany_start_recognition_tasks(NULL, NULL)) {
        gRecognitionError = [NSError errorWithDomain:@"coworkany.native_asr" code:-1 userInfo:@{
            NSLocalizedDescriptionKey: @"Failed to restart continuous speech recognition."
        }];
    }
}

static bool coworkany_start_recognition_tasks(char **error_code, char **error_message) {
    gRecognitionGeneration += 1;
    NSUInteger generation = gRecognitionGeneration;
    coworkany_reset_candidate_buffers();

    for (NSUInteger i = 0; i < gCandidateCount; i++) {
        [gTasks[i] cancel];
        gTasks[i] = nil;
        gRequests[i] = [[SFSpeechAudioBufferRecognitionRequest alloc] init];
        gRequests[i].shouldReportPartialResults = YES;

        __block NSUInteger candidateIndex = i;
        __block NSUInteger taskGeneration = generation;
        gTasks[i] = [gRecognizers[i] recognitionTaskWithRequest:gRequests[i] resultHandler:^(SFSpeechRecognitionResult * _Nullable result, NSError * _Nullable error) {
            if (taskGeneration != gRecognitionGeneration) {
                return;
            }

            if (result != nil && result.bestTranscription.formattedString != nil) {
                NSString *formattedString = result.bestTranscription.formattedString;
                BOOL transcriptChanged = ![gCandidateTranscripts[candidateIndex] isEqualToString:formattedString];
                [gCandidateTranscripts[candidateIndex] setString:formattedString];
                gCandidateConfidences[candidateIndex] = coworkany_average_confidence(result.bestTranscription);

                if (formattedString.length > 0 && transcriptChanged) {
                    gCandidateLastUpdateAt[candidateIndex] = [NSDate timeIntervalSinceReferenceDate];
                    coworkany_log([NSString stringWithFormat:@"candidate_update locale=%@ confidence=%.3f final=%d text=%@", gCandidateLocales[candidateIndex], gCandidateConfidences[candidateIndex], result.isFinal ? 1 : 0, formattedString]);
                    if (!gStopping && !result.isFinal) {
                        coworkany_schedule_finalize_timer(900.0, @"stability");
                    }
                }
            }

            if (error != nil) {
                gRecognitionError = error;
                coworkany_log([NSString stringWithFormat:@"candidate_error locale=%@ message=%@", gCandidateLocales[candidateIndex], error.localizedDescription ?: @"unknown"]);
                if (gStopping) {
                    coworkany_signal_completion_if_needed();
                    return;
                }

                if (gCandidateTranscripts[candidateIndex].length > 0) {
                    gCandidateHasFinal[candidateIndex] = YES;
                    coworkany_schedule_finalize_timer(250.0, @"error");
                }
                return;
            }

            if (result != nil && result.isFinal) {
                gCandidateHasFinal[candidateIndex] = YES;
                coworkany_schedule_finalize_timer(250.0, @"system_final");
            }
        }];

        if (gTasks[i] == nil) {
            coworkany_set_error(error_code, error_message, @"speech_not_supported", @"Failed to start speech recognizer task.");
            return false;
        }
    }

    return true;
}

bool coworkany_macos_native_asr_is_supported(void) {
    return coworkany_has_required_privacy_descriptions();
}

bool coworkany_macos_native_asr_start(const char *locale, char **error_code, char **error_message) {
    @autoreleasepool {
        if (gListening) {
            coworkany_set_error(error_code, error_message, @"already_listening", @"Native speech recognition is already running.");
            return false;
        }

        if (!coworkany_has_required_privacy_descriptions()) {
            coworkany_set_error(
                error_code,
                error_message,
                @"speech_bundle_required",
                @"Speech recognition requires launching CoworkAny as a macOS app bundle with privacy usage descriptions."
            );
            return false;
        }

        SFSpeechRecognizerAuthorizationStatus speechStatus = coworkany_request_speech_authorization();
        if (speechStatus == SFSpeechRecognizerAuthorizationStatusDenied || speechStatus == SFSpeechRecognizerAuthorizationStatusRestricted) {
            coworkany_set_error(error_code, error_message, @"speech_permission_denied", @"Speech recognition permission was denied.");
            return false;
        }
        if (speechStatus != SFSpeechRecognizerAuthorizationStatusAuthorized) {
            coworkany_set_error(error_code, error_message, @"speech_not_supported", @"Speech recognition is unavailable.");
            return false;
        }

        AVAuthorizationStatus micStatus = coworkany_request_microphone_authorization();
        if (micStatus != AVAuthorizationStatusAuthorized) {
            coworkany_set_error(error_code, error_message, @"microphone_denied", @"Microphone permission was denied.");
            return false;
        }

        NSArray<NSString *> *localeCandidates = coworkany_build_locale_candidates(locale);
        gCandidateCount = MIN(localeCandidates.count, (NSUInteger)MAX_CANDIDATES);
        if (gCandidateCount == 0) {
            coworkany_set_error(error_code, error_message, @"speech_not_supported", @"No speech recognition locale is available.");
            return false;
        }

        for (NSUInteger i = 0; i < gCandidateCount; i++) {
            NSString *localeId = localeCandidates[i];
            NSLocale *recognitionLocale = [[NSLocale alloc] initWithLocaleIdentifier:localeId];
            gCandidateLocales[i] = localeId;
            gCandidateTranscripts[i] = [[NSMutableString alloc] init];
            gRecognizers[i] = [[SFSpeechRecognizer alloc] initWithLocale:recognitionLocale];
            if (gRecognizers[i] == nil || !gRecognizers[i].available) {
                coworkany_set_error(error_code, error_message, @"speech_not_supported", @"Speech recognizer is unavailable.");
                coworkany_reset_state();
                return false;
            }
        }

        coworkany_log([NSString stringWithFormat:@"start locales=%@", [localeCandidates componentsJoinedByString:@","]]);

        gAudioEngine = [[AVAudioEngine alloc] init];
        AVAudioInputNode *inputNode = [gAudioEngine inputNode];
        if (inputNode == nil) {
            coworkany_set_error(error_code, error_message, @"speech_not_supported", @"Audio input is unavailable.");
            coworkany_reset_state();
            return false;
        }

        gRecognitionError = nil;
        gCompletionSemaphore = dispatch_semaphore_create(0);
        gStopping = NO;

        if (!coworkany_start_recognition_tasks(error_code, error_message)) {
            coworkany_reset_state();
            return false;
        }

        AVAudioFormat *format = [inputNode outputFormatForBus:0];
        [inputNode removeTapOnBus:0];
        [inputNode installTapOnBus:0 bufferSize:1024 format:format block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
            (void)when;
            for (NSUInteger i = 0; i < gCandidateCount; i++) {
                if (gRequests[i] != nil) {
                    [gRequests[i] appendAudioPCMBuffer:buffer];
                }
            }
        }];

        [gAudioEngine prepare];
        NSError *startError = nil;
        if (![gAudioEngine startAndReturnError:&startError]) {
            coworkany_set_error(error_code, error_message, @"speech_not_supported", startError.localizedDescription ?: @"Failed to start audio engine.");
            coworkany_reset_state();
            return false;
        }

        gListening = YES;
        return true;
    }
}

bool coworkany_macos_native_asr_stop(char **transcript, char **error_code, char **error_message) {
    @autoreleasepool {
        if (!gListening) {
            coworkany_set_error(error_code, error_message, @"not_listening", @"Native speech recognition is not running.");
            return false;
        }

        gStopping = YES;
        coworkany_cancel_finalize_timer();
        coworkany_log(@"stop requested");

        AVAudioInputNode *inputNode = [gAudioEngine inputNode];
        if (inputNode != nil) {
            [inputNode removeTapOnBus:0];
        }
        [gAudioEngine stop];
        for (NSUInteger i = 0; i < gCandidateCount; i++) {
            if (gRequests[i] != nil) {
                [gRequests[i] endAudio];
            }
        }

        if (gCompletionSemaphore != nil) {
            dispatch_semaphore_wait(gCompletionSemaphore, dispatch_time(DISPATCH_TIME_NOW, 1200 * NSEC_PER_MSEC));
        }

        NSInteger bestIndex = coworkany_select_best_candidate();
        NSString *resolvedTranscript = bestIndex >= 0 ? [gCandidateTranscripts[bestIndex] copy] : @"";
        if (bestIndex >= 0) {
            coworkany_log([NSString stringWithFormat:@"stop_resolved locale=%@ confidence=%.3f text=%@", gCandidateLocales[bestIndex], gCandidateConfidences[bestIndex], resolvedTranscript]);
        } else {
            coworkany_log(@"stop_resolved empty");
        }
        NSError *resolvedError = gRecognitionError;
        BOOL resolvedSegmentEmitted = gSegmentEmitted;
        coworkany_reset_state();

        if (resolvedTranscript.length > 0) {
            if (transcript != NULL) {
                *transcript = coworkany_strdup(resolvedTranscript);
            }
            return true;
        }

        if (resolvedSegmentEmitted) {
            return true;
        }

        if (resolvedError != nil) {
            if (coworkany_is_no_speech_error(resolvedError)) {
                coworkany_set_error(error_code, error_message, @"no_speech", @"No speech detected.");
                return false;
            }
            coworkany_set_error(
                error_code,
                error_message,
                @"native_asr_failed",
                resolvedError.localizedDescription ?: @"Speech recognition failed."
            );
            return false;
        }

        coworkany_set_error(error_code, error_message, @"no_speech", @"No speech detected.");
        return false;
    }
}

void coworkany_macos_native_asr_free_string(char *value) {
    if (value != NULL) {
        free(value);
    }
}
