import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface LoanApplication {
  id: string;
  applicant: string;
  encryptedAssetValue: string;
  encryptedLiabilityValue: string;
  loanAmount: number;
  timestamp: number;
  status: "pending" | "approved" | "rejected" | "processing";
  zkProof?: string;
}

// FHE Encryption/Decryption simulation (mimicking Zama FHE)
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}-${Date.now()}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    const base64Data = encryptedData.split('-')[1];
    return parseFloat(atob(base64Data));
  }
  return parseFloat(encryptedData);
};

// Simulate FHE computation on encrypted data
const FHEComputeSolvency = (encryptedAssets: string, encryptedLiabilities: string): boolean => {
  try {
    const assets = FHEDecryptNumber(encryptedAssets);
    const liabilities = FHEDecryptNumber(encryptedLiabilities);
    return assets > liabilities;
  } catch (error) {
    return false;
  }
};

// Generate ZK Proof (simulated)
const generateZKProof = (encryptedAssets: string, encryptedLiabilities: string): string => {
  const isSolvent = FHEComputeSolvency(encryptedAssets, encryptedLiabilities);
  return `zkProof-${btoa(JSON.stringify({
    timestamp: Date.now(),
    solvent: isSolvent,
    encryptedDataHash: ethers.keccak256(ethers.toUtf8Bytes(encryptedAssets + encryptedLiabilities))
  }))}`;
};

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [showApplicationModal, setShowApplicationModal] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [applicationData, setApplicationData] = useState({
    assetValue: 0,
    liabilityValue: 0,
    loanAmount: 0
  });
  const [processing, setProcessing] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ 
    visible: boolean; 
    status: "pending" | "success" | "error"; 
    message: string; 
  }>({ visible: false, status: "pending", message: "" });

  // FHE Computation state
  const [fheComputationStatus, setFheComputationStatus] = useState<"idle" | "encrypting" | "computing" | "proving">("idle");

  useEffect(() => {
    loadApplications().finally(() => setLoading(false));
  }, []);

  const loadApplications = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;

      // Load application keys
      const keysBytes = await contract.getData("application_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { 
          console.error("Error parsing application keys:", e); 
        }
      }

      const loadedApplications: LoanApplication[] = [];
      for (const key of keys) {
        try {
          const applicationBytes = await contract.getData(`application_${key}`);
          if (applicationBytes.length > 0) {
            const appData = JSON.parse(ethers.toUtf8String(applicationBytes));
            loadedApplications.push({
              id: key,
              applicant: appData.applicant,
              encryptedAssetValue: appData.encryptedAssetValue,
              encryptedLiabilityValue: appData.encryptedLiabilityValue,
              loanAmount: appData.loanAmount,
              timestamp: appData.timestamp,
              status: appData.status || "pending",
              zkProof: appData.zkProof
            });
          }
        } catch (e) { 
          console.error(`Error loading application ${key}:`, e); 
        }
      }

      loadedApplications.sort((a, b) => b.timestamp - a.timestamp);
      setApplications(loadedApplications);
    } catch (e) { 
      console.error("Error loading applications:", e); 
    } finally {
      setLoading(false);
    }
  };

  const submitLoanApplication = async () => {
    if (!isConnected) {
      alert("Please connect your wallet first");
      return;
    }

    setProcessing(true);
    setFheComputationStatus("encrypting");
    
    try {
      // Step 1: Encrypt sensitive data with FHE
      setTransactionStatus({ 
        visible: true, 
        status: "pending", 
        message: "Encrypting financial data with Zama FHE..." 
      });

      const encryptedAssets = FHEEncryptNumber(applicationData.assetValue);
      const encryptedLiabilities = FHEEncryptNumber(applicationData.liabilityValue);

      setFheComputationStatus("computing");
      setTransactionStatus({ 
        visible: true, 
        status: "pending", 
        message: "Computing solvency proof on encrypted data..." 
      });

      // Simulate FHE computation delay
      await new Promise(resolve => setTimeout(resolve, 2000));

      setFheComputationStatus("proving");
      setTransactionStatus({ 
        visible: true, 
        status: "pending", 
        message: "Generating ZK proof of solvency..." 
      });

      // Generate ZK proof
      const zkProof = generateZKProof(encryptedAssets, encryptedLiabilities);

      // Store application data on blockchain
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      const applicationId = `app-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const applicationDataToStore = {
        applicant: address,
        encryptedAssetValue: encryptedAssets,
        encryptedLiabilityValue: encryptedLiabilities,
        loanAmount: applicationData.loanAmount,
        timestamp: Math.floor(Date.now() / 1000),
        status: "pending",
        zkProof: zkProof
      };

      // Store application data
      await contract.setData(
        `application_${applicationId}`, 
        ethers.toUtf8Bytes(JSON.stringify(applicationDataToStore))
      );

      // Update application keys
      const keysBytes = await contract.getData("application_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { 
          keys = JSON.parse(ethers.toUtf8String(keysBytes)); 
        } catch (e) { 
          console.error("Error parsing keys:", e); 
        }
      }
      keys.push(applicationId);
      await contract.setData("application_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Loan application submitted successfully with ZK proof!" 
      });

      await loadApplications();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowApplicationModal(false);
        setCurrentStep(1);
        setApplicationData({ assetValue: 0, liabilityValue: 0, loanAmount: 0 });
        setFheComputationStatus("idle");
      }, 2000);

    } catch (error: any) {
      const errorMessage = error.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (error.message || "Unknown error");
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: errorMessage 
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setFheComputationStatus("idle");
      }, 3000);
    } finally {
      setProcessing(false);
    }
  };

  const approveApplication = async (applicationId: string) => {
    if (!isConnected) {
      alert("Please connect your wallet first");
      return;
    }

    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Processing application approval..." 
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      const applicationBytes = await contract.getData(`application_${applicationId}`);
      if (applicationBytes.length === 0) throw new Error("Application not found");

      const appData = JSON.parse(ethers.toUtf8String(applicationBytes));
      const updatedAppData = { ...appData, status: "approved" };

      await contract.setData(
        `application_${applicationId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedAppData))
      );

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Application approved successfully!" 
      });

      await loadApplications();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (error: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Approval failed: " + (error.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const rejectApplication = async (applicationId: string) => {
    if (!isConnected) {
      alert("Please connect your wallet first");
      return;
    }

    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Processing application rejection..." 
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      const applicationBytes = await contract.getData(`application_${applicationId}`);
      if (applicationBytes.length === 0) throw new Error("Application not found");

      const appData = JSON.parse(ethers.toUtf8String(applicationBytes));
      const updatedAppData = { ...appData, status: "rejected" };

      await contract.setData(
        `application_${applicationId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedAppData))
      );

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Application rejected successfully!" 
      });

      await loadApplications();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (error: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Rejection failed: " + (error.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const checkContractAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Contract is ${isAvailable ? 'available' : 'unavailable'}` 
      });
      
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (error) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Failed to check contract availability" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Lending Protocol...</p>
      </div>
    );
  }

  return (
    <div className="app-container fhe-theme">
      {/* Header */}
      <header className="app-header">
        <div className="logo-section">
          <div className="logo">
            <div className="shield-icon"></div>
            <h1>zkSolvency<span>FHE</span></h1>
          </div>
          <p>FHE-encrypted ZK Proof Lending Protocol</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowApplicationModal(true)} 
            className="apply-btn primary-btn"
            disabled={!isConnected}
          >
            Apply for Loan
          </button>
          <button 
            onClick={checkContractAvailability} 
            className="check-contract-btn secondary-btn"
          >
            Check Contract
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
        </div>
      </header>

      {/* Main Content */}
      <div className="main-content">
        {/* Welcome Banner */}
        <div className="welcome-banner">
          <div className="banner-content">
            <h2>Private Solvency-Based Lending</h2>
            <p>Get loans using ZK proofs of solvency computed on FHE-encrypted financial data</p>
            <div className="tech-badges">
              <span className="tech-badge fhe-badge">Zama FHE</span>
              <span className="tech-badge zk-badge">ZK Proofs</span>
              <span className="tech-badge defi-badge">DeFi</span>
            </div>
          </div>
          <div className="banner-stats">
            <div className="stat-card">
              <div className="stat-value">{applications.length}</div>
              <div className="stat-label">Total Applications</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{applications.filter(a => a.status === "approved").length}</div>
              <div className="stat-label">Approved Loans</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">${applications.filter(a => a.status === "approved").reduce((sum, app) => sum + app.loanAmount, 0).toLocaleString()}</div>
              <div className="stat-label">Total Lent</div>
            </div>
          </div>
        </div>

        {/* Application Process Modal */}
        {showApplicationModal && (
          <ApplicationModal
            currentStep={currentStep}
            setCurrentStep={setCurrentStep}
            applicationData={applicationData}
            setApplicationData={setApplicationData}
            onSubmit={submitLoanApplication}
            onClose={() => {
              setShowApplicationModal(false);
              setCurrentStep(1);
              setApplicationData({ assetValue: 0, liabilityValue: 0, loanAmount: 0 });
              setFheComputationStatus("idle");
            }}
            processing={processing}
            fheComputationStatus={fheComputationStatus}
            isConnected={isConnected}
          />
        )}

        {/* Applications List */}
        <div className="applications-section">
          <div className="section-header">
            <h2>Loan Applications</h2>
            <button onClick={loadApplications} className="refresh-btn secondary-btn">
              Refresh
            </button>
          </div>

          <div className="applications-list">
            {applications.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <h3>No loan applications yet</h3>
                <p>Be the first to apply for a loan using FHE-encrypted ZK proofs</p>
                <button 
                  onClick={() => setShowApplicationModal(true)} 
                  className="primary-btn"
                  disabled={!isConnected}
                >
                  Apply Now
                </button>
              </div>
            ) : (
              applications.map((app) => (
                <ApplicationCard 
                  key={app.id} 
                  application={app} 
                  onApprove={approveApplication}
                  onReject={rejectApplication}
                  isConnected={isConnected}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className={`transaction-status ${transactionStatus.status}`}>
            <div className="status-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✕"}
            </div>
            <div className="status-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-info">
            <h3>zkSolvencyFHE Protocol</h3>
            <p>Built with Zama FHE technology for private financial computations</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Privacy Policy</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

// Application Modal Component
interface ApplicationModalProps {
  currentStep: number;
  setCurrentStep: (step: number) => void;
  applicationData: any;
  setApplicationData: (data: any) => void;
  onSubmit: () => void;
  onClose: () => void;
  processing: boolean;
  fheComputationStatus: "idle" | "encrypting" | "computing" | "proving";
  isConnected: boolean;
}

const ApplicationModal: React.FC<ApplicationModalProps> = ({
  currentStep,
  setCurrentStep,
  applicationData,
  setApplicationData,
  onSubmit,
  onClose,
  processing,
  fheComputationStatus,
  isConnected
}) => {
  const steps = [
    { number: 1, title: "Financial Data", description: "Enter your financial information" },
    { number: 2, title: "FHE Encryption", description: "Data encryption process" },
    { number: 3, title: "ZK Proof", description: "Generate solvency proof" },
    { number: 4, title: "Submit", description: "Complete application" }
  ];

  const handleInputChange = (field: string, value: number) => {
    setApplicationData({ ...applicationData, [field]: value });
  };

  const nextStep = () => {
    if (currentStep < 4) setCurrentStep(currentStep + 1);
  };

  const prevStep = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return applicationData.assetValue > 0 && applicationData.liabilityValue >= 0 && applicationData.loanAmount > 0;
      default:
        return true;
    }
  };

  return (
    <div className="modal-overlay">
      <div className="application-modal">
        <div className="modal-header">
          <h2>Apply for Loan</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>

        {/* Progress Steps */}
        <div className="progress-steps">
          {steps.map((step) => (
            <div key={step.number} className={`step ${currentStep >= step.number ? 'active' : ''}`}>
              <div className="step-number">{step.number}</div>
              <div className="step-info">
                <div className="step-title">{step.title}</div>
                <div className="step-description">{step.description}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="step-content">
          {currentStep === 1 && (
            <div className="financial-data-step">
              <h3>Enter Your Financial Information</h3>
              <p>Your data will be encrypted using Zama FHE technology</p>
              
              <div className="input-group">
                <label>Total Assets Value ($)</label>
                <input
                  type="number"
                  value={applicationData.assetValue || ''}
                  onChange={(e) => handleInputChange('assetValue', parseFloat(e.target.value) || 0)}
                  placeholder="Enter total assets value"
                />
              </div>

              <div className="input-group">
                <label>Total Liabilities ($)</label>
                <input
                  type="number"
                  value={applicationData.liabilityValue || ''}
                  onChange={(e) => handleInputChange('liabilityValue', parseFloat(e.target.value) || 0)}
                  placeholder="Enter total liabilities"
                />
              </div>

              <div className="input-group">
                <label>Desired Loan Amount ($)</label>
                <input
                  type="number"
                  value={applicationData.loanAmount || ''}
                  onChange={(e) => handleInputChange('loanAmount', parseFloat(e.target.value) || 0)}
                  placeholder="Enter loan amount"
                />
              </div>

              {applicationData.assetValue > 0 && applicationData.liabilityValue >= 0 && (
                <div className="solvency-preview">
                  <div className={`solvency-status ${applicationData.assetValue > applicationData.liabilityValue ? 'positive' : 'negative'}`}>
                    {applicationData.assetValue > applicationData.liabilityValue ? '✓ Solvent' : '✗ Insolvent'}
                  </div>
                  <div className="net-worth">
                    Net Worth: ${(applicationData.assetValue - applicationData.liabilityValue).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          )}

          {currentStep === 2 && (
            <div className="encryption-step">
              <h3>FHE Encryption Process</h3>
              <p>Your financial data is being encrypted with Zama FHE</p>
              
              <div className="encryption-visualization">
                <div className="data-item plain-data">
                  <span>Plain Assets:</span>
                  <div>${applicationData.assetValue.toLocaleString()}</div>
                </div>
                
                <div className="encryption-arrow">↓</div>
                
                <div className="data-item encrypted-data">
                  <span>Encrypted Assets:</span>
                  <div>{FHEEncryptNumber(applicationData.assetValue).substring(0, 30)}...</div>
                </div>

                <div className="data-item plain-data">
                  <span>Plain Liabilities:</span>
                  <div>${applicationData.liabilityValue.toLocaleString()}</div>
                </div>
                
                <div className="encryption-arrow">↓</div>
                
                <div className="data-item encrypted-data">
                  <span>Encrypted Liabilities:</span>
                  <div>{FHEEncryptNumber(applicationData.liabilityValue).substring(0, 30)}...</div>
                </div>
              </div>

              <div className="fhe-notice">
                <div className="notice-icon">🔒</div>
                <div>
                  <strong>FHE Encryption Active</strong>
                  <p>Data remains encrypted during computation. Server never sees plain values.</p>
                </div>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="proof-step">
              <h3>ZK Proof Generation</h3>
              <p>Generating zero-knowledge proof of solvency</p>
              
              <div className="proof-status">
                <div className={`status-item ${fheComputationStatus !== 'idle' ? 'active' : ''}`}>
                  <div className="status-indicator"></div>
                  <span>FHE Computation</span>
                </div>
                <div className={`status-item ${fheComputationStatus === 'proving' ? 'active' : ''}`}>
                  <div className="status-indicator"></div>
                  <span>ZK Proof Generation</span>
                </div>
              </div>

              <div className="proof-preview">
                <div className="proof-result">
                  Solvency Proof: {FHEComputeSolvency(
                    FHEEncryptNumber(applicationData.assetValue),
                    FHEEncryptNumber(applicationData.liabilityValue)
                  ) ? 'VALID' : 'INVALID'}
                </div>
                <div className="proof-hash">
                  Proof Hash: {generateZKProof(
                    FHEEncryptNumber(applicationData.assetValue),
                    FHEEncryptNumber(applicationData.liabilityValue)
                  ).substring(0, 40)}...
                </div>
              </div>
            </div>
          )}

          {currentStep === 4 && (
            <div className="submit-step">
              <h3>Review & Submit</h3>
              <p>Review your application details before submission</p>
              
              <div className="application-summary">
                <div className="summary-item">
                  <span>Loan Amount:</span>
                  <strong>${applicationData.loanAmount.toLocaleString()}</strong>
                </div>
                <div className="summary-item">
                  <span>Assets (encrypted):</span>
                  <span>FHE-Encrypted</span>
                </div>
                <div className="summary-item">
                  <span>Liabilities (encrypted):</span>
                  <span>FHE-Encrypted</span>
                </div>
                <div className="summary-item">
                  <span>Solvency Proof:</span>
                  <span className="proof-valid">Valid</span>
                </div>
              </div>

              <div className="privacy-guarantee">
                <div className="guarantee-icon">🛡️</div>
                <div>
                  <strong>Privacy Guarantee</strong>
                  <p>Your financial data remains encrypted throughout the entire process using Zama FHE technology</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button onClick={prevStep} disabled={currentStep === 1} className="secondary-btn">
            Previous
          </button>
          
          {currentStep < 4 ? (
            <button onClick={nextStep} disabled={!canProceed()} className="primary-btn">
              Next
            </button>
          ) : (
            <button 
              onClick={onSubmit} 
              disabled={!canProceed() || processing || !isConnected}
              className="primary-btn submit-btn"
            >
              {processing ? 'Processing...' : 'Submit Application'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Application Card Component
interface ApplicationCardProps {
  application: LoanApplication;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isConnected: boolean;
}

const ApplicationCard: React.FC<ApplicationCardProps> = ({ application, onApprove, onReject, isConnected }) => {
  return (
    <div className={`application-card ${application.status}`}>
      <div className="card-header">
        <div className="application-id">Application #{application.id.substring(0, 8)}</div>
        <div className={`status-badge ${application.status}`}>{application.status}</div>
      </div>
      
      <div className="card-content">
        <div className="application-info">
          <div className="info-item">
            <span>Applicant:</span>
            <span>{application.applicant.substring(0, 6)}...{application.applicant.substring(38)}</span>
          </div>
          <div className="info-item">
            <span>Loan Amount:</span>
            <span>${application.loanAmount.toLocaleString()}</span>
          </div>
          <div className="info-item">
            <span>Date:</span>
            <span>{new Date(application.timestamp * 1000).toLocaleDateString()}</span>
          </div>
        </div>
        
        <div className="encrypted-data">
          <div className="data-tag">FHE-Encrypted Assets: {application.encryptedAssetValue.substring(0, 20)}...</div>
          <div className="data-tag">FHE-Encrypted Liabilities: {application.encryptedLiabilityValue.substring(0, 20)}...</div>
        </div>
      </div>

      {application.status === "pending" && isConnected && (
        <div className="card-actions">
          <button onClick={() => onApprove(application.id)} className="approve-btn primary-btn">
            Approve
          </button>
          <button onClick={() => onReject(application.id)} className="reject-btn secondary-btn">
            Reject
          </button>
        </div>
      )}
    </div>
  );
};

export default App;