import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import './ModalDialog.css';

interface ModalDialogProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
}

export const ModalDialog: React.FC<ModalDialogProps> = ({ open, onClose, title, children }) => {
    const { t } = useTranslation();
    return (
        <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="modal-dialog-overlay" />
                <Dialog.Content className="modal-dialog-content">
                    <div className="modal-dialog-header">
                        <Dialog.Title className="modal-dialog-title">{title}</Dialog.Title>
                        <button
                            className="modal-close-btn"
                            onClick={onClose}
                            aria-label={t('common.close')}
                        >
                            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.50001L3.21846 10.9684C2.99391 11.193 2.99391 11.5571 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31322L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.5571 12.0062 11.193 11.7816 10.9684L8.31322 7.50001L11.7816 4.03157Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
                        </button>
                    </div>
                    <div className="modal-dialog-body">
                        {children}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
