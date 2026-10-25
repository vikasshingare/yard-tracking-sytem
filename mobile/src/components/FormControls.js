import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput as NativeTextInput,
  View,
} from 'react-native';

const palette = {
  ink: '#111111',
  placeholder: '#3D4650',
  border: '#111111',
  blue: '#1769AA',
  white: '#FFFFFF',
  muted: '#66737D',
};

export function TextInput({ style, placeholderTextColor, ...props }) {
  return (
    <NativeTextInput
      {...props}
      style={[styles.input, style]}
      placeholderTextColor={placeholderTextColor || palette.placeholder}
      selectionColor={palette.blue}
      underlineColorAndroid="transparent"
      cursorColor={palette.blue}
    />
  );
}

// Picker.Item is a lightweight data marker. YardPicker renders choices in its
// own light modal so the list remains readable even when Android is in dark mode.
function PickerItem() {
  return null;
}

function YardPicker({
  style,
  children,
  selectedValue,
  onValueChange,
  placeholder = 'Select an option',
  disabled = false,
  prompt = 'SELECT AN OPTION',
  ...props
}) {
  const [open, setOpen] = useState(false);
  const items = useMemo(
    () => React.Children.toArray(children)
      .filter((child) => React.isValidElement(child) && child.type === PickerItem)
      .map((child) => ({ label: String(child.props.label ?? child.props.value ?? ''), value: child.props.value })),
    [children],
  );
  const selectedIndex = items.findIndex((item) => String(item.value) === String(selectedValue));
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : null;

  function select(item, index) {
    onValueChange?.(item.value, index);
    setOpen(false);
  }

  return (
    <View style={[styles.pickerField, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selectedItem?.label || placeholder}
        accessibilityHint="Opens a list of choices"
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.pickerTrigger, pressed && styles.pickerPressed, disabled && styles.disabled]}
      >
        <Text numberOfLines={1} style={[styles.pickerValue, !selectedItem && styles.pickerPlaceholder]}>
          {selectedItem?.label || placeholder}
        </Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close choices" />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{prompt}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {items.map((item, index) => {
                const isSelected = String(item.value) === String(selectedValue);
                return (
                  <Pressable
                    key={`${String(item.value)}-${index}`}
                    accessibilityRole="button"
                    onPress={() => select(item, index)}
                    style={({ pressed }) => [styles.option, isSelected && styles.optionSelected, pressed && styles.optionPressed]}
                  >
                    <Text style={styles.optionText}>{item.label}</Text>
                    {isSelected && <Text style={styles.check}>✓</Text>}
                  </Pressable>
                );
              })}
              {items.length === 0 && <Text style={styles.empty}>No options available</Text>}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

PickerItem.displayName = 'YardPickerItem';
YardPicker.Item = PickerItem;
export { YardPicker as Picker };

const styles = StyleSheet.create({
  input: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1.25,
    borderColor: palette.border,
    borderRadius: 14,
    backgroundColor: palette.white,
    color: palette.ink,
    fontSize: 17,
    fontWeight: '600',
    textAlignVertical: 'center',
  },
  pickerField: {
    minHeight: 58,
    backgroundColor: palette.white,
  },
  pickerTrigger: {
    minHeight: 58,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: palette.white,
  },
  pickerValue: {
    flex: 1,
    color: palette.ink,
    fontSize: 17,
    fontWeight: '600',
  },
  pickerPlaceholder: {
    color: palette.placeholder,
  },
  chevron: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 27,
    fontWeight: '800',
  },
  pickerPressed: {
    backgroundColor: '#F4F7F9',
  },
  disabled: {
    opacity: 0.55,
  },
  modalRoot: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 18, 25, 0.48)',
  },
  modalCard: {
    width: '100%',
    maxHeight: '72%',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#111111',
    borderRadius: 16,
    backgroundColor: palette.white,
    elevation: 12,
  },
  modalTitle: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
    color: palette.ink,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  option: {
    minHeight: 58,
    paddingHorizontal: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#D5DADF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.white,
  },
  optionSelected: {
    backgroundColor: '#EAF3FA',
  },
  optionPressed: {
    backgroundColor: '#DCEAF4',
  },
  optionText: {
    flex: 1,
    color: palette.ink,
    fontSize: 17,
    fontWeight: '600',
  },
  check: {
    marginLeft: 12,
    color: '#145F34',
    fontSize: 20,
    fontWeight: '900',
  },
  empty: {
    padding: 18,
    color: palette.ink,
    fontSize: 16,
  },
});
